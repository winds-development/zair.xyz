import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  Events,
  MessageFlags,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type Invite,
  type Message,
  type User,
} from "discord.js";
import { logger } from "./logger";

/* ------------------------------------------------------------------ */
/*  Shortcut aliases (work only with the prefix, e.g. !si  !lp  !inv)   */
/* ------------------------------------------------------------------ */

const commandAliases: Record<string, string> = {
  h: "help",
  st: "stats",
  pg: "ping",
  prem: "premium",
  ut: "uptime",
  am: "automod",
  b: "ban",
  k: "kick",
  mu: "mute",
  ub: "unban",
  um: "unmute",
  s: "say",
  e: "embed",
  d: "dm",
  tk: "ticket",
  wc: "welcomer",
  lv: "leaver",
  an: "antinuke",
  wl: "whitelist",
  eo: "extraowner",
  si: "serverinfo",
  inv: "invites",
  ir: "inviter",
  ms: "messages",
  msgs: "messages",
  lp: "lastping",
  bal: "coz",
  cash: "coz",
  dl: "daily",
  pay: "give",
  cf: "coinflip",
  sl: "slots",
  lb: "cozlb",
  top: "cozlb",
  ri: "resetinvites",
  rm: "resetmessages",
  rc: "resetcoz",
};

const extraCommandNames = new Set([
  "serverinfo",
  "invites",
  "inviter",
  "messages",
  "afk",
  "lastping",
  "coz",
  "daily",
  "give",
  "coinflip",
  "slots",
  "cozlb",
  "resetinvites",
  "resetmessages",
  "resetcoz",
]);

export function resolveCommandAlias(
  command: string | undefined,
  hasPrefix: boolean,
): string | undefined {
  if (!command) {
    return command;
  }
  // Shortcuts only work with the prefix, so no-prefix users don't trigger
  // commands by typing normal one-letter words in chat.
  if (!hasPrefix) {
    return command;
  }
  return commandAliases[command] ?? command;
}

export function isExtraCommand(command: string | undefined): boolean {
  return Boolean(command && extraCommandNames.has(command));
}

/* ------------------------------------------------------------------ */
/*  Small JSON data store (survives restarts if the disk is persistent) */
/* ------------------------------------------------------------------ */

type AfkEntry = { reason: string; since: number };
type LastPing = {
  authorId: string;
  channelId: string;
  messageId: string;
  content: string;
  at: number;
};
type InviterRecord = {
  inviterId: string | null;
  code: string | null;
  kind: "invite" | "vanity" | "unknown";
  at: number;
  left: boolean;
};
type InviteStat = { joins: number; leaves: number };
type MessageStat = { total: number; day: string; today: number };

type CozAccount = { balance: number; lastDaily: number; streak: number };

type Store = {
  afkGlobal: Record<string, AfkEntry>;
  afkServer: Record<string, AfkEntry>;
  messages: Record<string, MessageStat>;
  inviterOf: Record<string, InviterRecord>;
  inviteStats: Record<string, InviteStat>;
  lastPing: Record<string, LastPing>;
  coz: Record<string, CozAccount>;
};

const dataFile =
  process.env["ZAIR_DATA_FILE"] ??
  path.join(process.cwd(), "data", "zair-data.json");

let store: Store = emptyStore();
let saveTimer: NodeJS.Timeout | null = null;

function emptyStore(): Store {
  return {
    afkGlobal: {},
    afkServer: {},
    messages: {},
    inviterOf: {},
    inviteStats: {},
    lastPing: {},
    coz: {},
  };
}

async function loadStore() {
  try {
    const raw = await readFile(dataFile, "utf8");
    store = { ...emptyStore(), ...(JSON.parse(raw) as Partial<Store>) };
  } catch {
    store = emptyStore();
  }
}

function saveNow() {
  try {
    mkdirSync(path.dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, JSON.stringify(store));
  } catch (error) {
    logger.warn({ err: error }, "Could not save ZAIR data file");
  }
}

function scheduleSave() {
  if (saveTimer) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 10_000);
  saveTimer.unref();
}

/* ------------------------------------------------------------------ */
/*  Invite tracking                                                    */
/* ------------------------------------------------------------------ */

type CachedInvite = {
  uses: number;
  maxUses: number;
  inviterId: string | null;
  deletedAt?: number;
};

const inviteCache = new Map<string, Map<string, CachedInvite>>();
const noInvitePermission = new Set<string>();

function cacheFromInvites(invites: Iterable<Invite>) {
  const map = new Map<string, CachedInvite>();
  for (const invite of invites) {
    map.set(invite.code, {
      uses: invite.uses ?? 0,
      maxUses: invite.maxUses ?? 0,
      inviterId: invite.inviter?.id ?? null,
    });
  }
  return map;
}

async function cacheGuildInvites(guild: Guild) {
  try {
    const invites = await guild.invites.fetch();
    inviteCache.set(guild.id, cacheFromInvites(invites.values()));
    noInvitePermission.delete(guild.id);
  } catch {
    noInvitePermission.add(guild.id);
  }
}

async function detectInviter(guild: Guild): Promise<InviterRecord> {
  const record: InviterRecord = {
    inviterId: null,
    code: null,
    kind: "unknown",
    at: Date.now(),
    left: false,
  };

  const before = inviteCache.get(guild.id) ?? new Map<string, CachedInvite>();

  try {
    const fresh = await guild.invites.fetch();
    noInvitePermission.delete(guild.id);

    let usedCode: string | null = null;
    let usedInviter: string | null = null;

    for (const invite of fresh.values()) {
      const previous = before.get(invite.code);
      const uses = invite.uses ?? 0;
      if ((previous && uses > previous.uses) || (!previous && uses > 0)) {
        usedCode = invite.code;
        usedInviter = invite.inviter?.id ?? null;
        break;
      }
    }

    // An invite that hit its max uses is deleted right after the join.
    if (!usedCode) {
      for (const [code, cached] of before) {
        const recentlyDeleted =
          cached.deletedAt !== undefined && Date.now() - cached.deletedAt < 15_000;
        const missing = !fresh.has(code);
        if (
          (recentlyDeleted || (missing && cached.maxUses > 0)) &&
          (cached.maxUses === 0 || cached.uses + 1 >= cached.maxUses)
        ) {
          usedCode = code;
          usedInviter = cached.inviterId;
          break;
        }
      }
    }

    inviteCache.set(guild.id, cacheFromInvites(fresh.values()));

    if (usedCode) {
      record.code = usedCode;
      record.inviterId = usedInviter;
      record.kind = "invite";
    } else if (guild.vanityURLCode) {
      record.code = guild.vanityURLCode;
      record.kind = "vanity";
    }
  } catch {
    noInvitePermission.add(guild.id);
  }

  return record;
}

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

export async function initExtras(client: Client) {
  await loadStore();

  process.once("SIGTERM", saveNow);
  process.once("SIGINT", saveNow);

  client.once(Events.ClientReady, async (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      await cacheGuildInvites(guild);
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    await cacheGuildInvites(guild);
  });

  client.on(Events.InviteCreate, (invite) => {
    const guildId = invite.guild?.id;
    if (!guildId) {
      return;
    }
    const map = inviteCache.get(guildId) ?? new Map<string, CachedInvite>();
    map.set(invite.code, {
      uses: invite.uses ?? 0,
      maxUses: invite.maxUses ?? 0,
      inviterId: invite.inviter?.id ?? null,
    });
    inviteCache.set(guildId, map);
  });

  client.on(Events.InviteDelete, (invite) => {
    const guildId = invite.guild?.id;
    const cached = guildId ? inviteCache.get(guildId)?.get(invite.code) : null;
    if (cached) {
      cached.deletedAt = Date.now();
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const record = await detectInviter(member.guild);
      store.inviterOf[`${member.guild.id}:${member.id}`] = record;
      if (record.inviterId) {
        const key = `${member.guild.id}:${record.inviterId}`;
        const stat = store.inviteStats[key] ?? { joins: 0, leaves: 0 };
        stat.joins += 1;
        store.inviteStats[key] = stat;
      }
      scheduleSave();
    } catch (error) {
      logger.warn({ err: error }, "Invite tracking failed on member join");
    }
  });

  client.on(Events.GuildMemberRemove, (member) => {
    const record = store.inviterOf[`${member.guild.id}:${member.id}`];
    if (record && !record.left) {
      record.left = true;
      if (record.inviterId) {
        const key = `${member.guild.id}:${record.inviterId}`;
        const stat = store.inviteStats[key] ?? { joins: 0, leaves: 0 };
        stat.leaves += 1;
        store.inviteStats[key] = stat;
      }
      scheduleSave();
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Passive tracking: message counts, last ping, AFK                    */
/* ------------------------------------------------------------------ */

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(text: string, max = 150) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const cut = trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
  return cut
    .replace(/`/g, "'")
    .replace(/@(everyone|here)/g, "@\u200b$1");
}

function unix(ms: number) {
  return Math.floor(ms / 1000);
}

function isAfkCommand(content: string) {
  return /^(<@!?\d+>\s*)?!\s*afk\b/i.test(content.trim());
}

function disappearAfter(promise: Promise<Message>, ms: number) {
  void promise
    .then((sent) => {
      setTimeout(() => {
        sent.delete().catch(() => undefined);
      }, ms).unref();
    })
    .catch(() => undefined);
}

export async function trackMessage(message: Message) {
  if (!message.guild || message.author.bot) {
    return;
  }

  const guildId = message.guild.id;
  const userId = message.author.id;

  // 1) message counter
  const countKey = `${guildId}:${userId}`;
  const today = todayKey();
  const stat = store.messages[countKey] ?? { total: 0, day: today, today: 0 };
  if (stat.day !== today) {
    stat.day = today;
    stat.today = 0;
  }
  stat.total += 1;
  stat.today += 1;
  store.messages[countKey] = stat;

  // 2) last ping log
  for (const mentioned of message.mentions.users.values()) {
    if (mentioned.bot || mentioned.id === userId) {
      continue;
    }
    store.lastPing[`${guildId}:${mentioned.id}`] = {
      authorId: userId,
      channelId: message.channelId,
      messageId: message.id,
      content: cleanText(message.content),
      at: Date.now(),
    };
  }

  scheduleSave();

  if (!message.channel.isSendable()) {
    return;
  }

  // 3) the author came back from AFK
  if (!isAfkCommand(message.content)) {
    const serverKey = `${guildId}:${userId}`;
    const entry = store.afkServer[serverKey] ?? store.afkGlobal[userId];
    if (entry) {
      delete store.afkServer[serverKey];
      delete store.afkGlobal[userId];
      scheduleSave();
      disappearAfter(
        message.reply({
          content: `Welcome back ${message.author}! I removed your AFK. You went AFK <t:${unix(entry.since)}:R>.`,
          allowedMentions: { parse: [], repliedUser: false },
        }),
        10_000,
      );
    }
  }

  // 4) someone pinged an AFK user
  const notes: string[] = [];
  for (const mentioned of message.mentions.users.values()) {
    if (mentioned.bot || mentioned.id === userId) {
      continue;
    }
    const entry =
      store.afkServer[`${guildId}:${mentioned.id}`] ??
      store.afkGlobal[mentioned.id];
    if (entry && notes.length < 3) {
      notes.push(
        `**${cleanText(mentioned.displayName, 40)}** is AFK: ${entry.reason} (<t:${unix(entry.since)}:R>)`,
      );
    }
  }
  if (notes.length > 0) {
    disappearAfter(
      message.reply({
        content: notes.join("\n"),
        allowedMentions: { parse: [], repliedUser: false },
      }),
      15_000,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Replies                                                            */
/* ------------------------------------------------------------------ */

const embedColor = 0x2b2d31;
// Same dot the bot uses on its Ping / Uptime / Stats cards
const dot = "<a:griffon_Cdot:1548626537660551208>";

function botLabel(message: Message) {
  const user = message.client.user;
  return user?.displayName || user?.username || "ZAIR";
}

function card(message: Message, title: string, lines: string[]) {
  if (!message.channel.isSendable()) {
    return;
  }
  return message.channel.send({
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    components: [
      {
        type: 17,
        accent_color: embedColor,
        components: [
          { type: 10, content: `**${botLabel(message)} - ${title}**` },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: lines.join("\n") },
        ],
      },
    ],
  } as never);
}

async function resolveTarget(message: Message, args: string[]): Promise<User> {
  const botId = message.client.user?.id;
  const mentioned = message.mentions.users.find((user) => user.id !== botId);
  if (mentioned) {
    return mentioned;
  }
  const idArg = args.find((arg) => /^\d{17,20}$/.test(arg));
  if (idArg) {
    try {
      return await message.client.users.fetch(idArg);
    } catch {
      // fall through to the author
    }
  }
  return message.author;
}

/* ------------------------------------------------------------------ */
/*  Commands                                                           */
/* ------------------------------------------------------------------ */

export async function respondToExtraCommand(
  message: Message,
  command: string,
  args: string[],
) {
  if (!message.guild) {
    return;
  }

  if (command === "serverinfo") {
    return respondServerInfo(message, message.guild);
  }
  if (command === "invites") {
    return respondInvites(message, args);
  }
  if (command === "inviter") {
    return respondInviter(message, args);
  }
  if (command === "messages") {
    return respondMessages(message, args);
  }
  if (command === "afk") {
    return respondAfk(message, args);
  }
  if (command === "lastping") {
    return respondLastPing(message);
  }
  if (command === "coz") {
    return respondCoz(message, args);
  }
  if (command === "daily") {
    return respondDaily(message);
  }
  if (command === "give") {
    return respondGive(message, args);
  }
  if (command === "coinflip") {
    return respondCoinflip(message, args);
  }
  if (command === "slots") {
    return respondSlots(message, args);
  }
  if (command === "cozlb") {
    return respondCozLeaderboard(message);
  }
  if (
    command === "resetinvites" ||
    command === "resetmessages" ||
    command === "resetcoz"
  ) {
    return respondReset(message, command, args);
  }
}

function respondServerInfo(message: Message, guild: Guild) {
  return card(message, "Server Info", [
    `${dot} **Name :** ${guild.name}`,
    `${dot} **ID :** \`${guild.id}\``,
    `${dot} **Owner :** <@${guild.ownerId}>`,
    `${dot} **Members :** \`${guild.memberCount}\``,
    `${dot} **Channels :** \`${guild.channels.cache.size}\``,
    `${dot} **Roles :** \`${guild.roles.cache.size}\``,
    `${dot} **Boosts :** \`${guild.premiumSubscriptionCount ?? 0}\` (Tier ${guild.premiumTier})`,
    `${dot} **Created :** <t:${unix(guild.createdTimestamp)}:F> (<t:${unix(guild.createdTimestamp)}:R>)`,
  ]);
}

async function respondInvites(message: Message, args: string[]) {
  const guild = message.guild!;
  const user = await resolveTarget(message, args);
  const stat = store.inviteStats[`${guild.id}:${user.id}`] ?? {
    joins: 0,
    leaves: 0,
  };
  const current = Math.max(0, stat.joins - stat.leaves);

  const lines = [
    `${dot} **User :** ${user}`,
    `${dot} **Total Invites :** \`${stat.joins}\``,
    `${dot} **Left :** \`${stat.leaves}\``,
    `${dot} **Still In Server :** \`${current}\``,
  ];
  if (noInvitePermission.has(guild.id)) {
    lines.push(
      "",
      "I need the **Manage Server** permission to track invites in this server.",
    );
  } else {
    lines.push("", "-# Counted from when the bot started tracking invites.");
  }
  return card(message, "Invites", lines);
}

async function respondInviter(message: Message, args: string[]) {
  const guild = message.guild!;
  const user = await resolveTarget(message, args);
  const record = store.inviterOf[`${guild.id}:${user.id}`];

  if (!record) {
    return card(message, "Inviter", [
      `${dot} **User :** ${user}`,
      "No invite record for this user. They joined before tracking started, or the bot could not see invites.",
    ]);
  }

  let by = "Unknown (could not detect)";
  if (record.kind === "vanity") {
    by = `Vanity URL (\`${record.code}\`)`;
  } else if (record.kind === "invite" && record.inviterId) {
    by = `<@${record.inviterId}>`;
  } else if (record.kind === "invite") {
    by = "Unknown user";
  }

  const lines = [
    `${dot} **User :** ${user}`,
    `${dot} **Invited By :** ${by}`,
  ];
  if (record.code && record.kind === "invite") {
    lines.push(`${dot} **Invite Code :** \`${record.code}\``);
  }
  lines.push(`${dot} **Joined :** <t:${unix(record.at)}:R>`);
  return card(message, "Inviter", lines);
}

async function respondMessages(message: Message, args: string[]) {
  const guild = message.guild!;
  const user = await resolveTarget(message, args);
  const stat = store.messages[`${guild.id}:${user.id}`];
  const total = stat?.total ?? 0;
  const today = stat && stat.day === todayKey() ? stat.today : 0;

  const prefix = `${guild.id}:`;
  const rank =
    Object.entries(store.messages).filter(
      ([key, value]) => key.startsWith(prefix) && value.total > total,
    ).length + 1;

  return card(message, "Messages", [
    `${dot} **User :** ${user}`,
    `${dot} **Total Messages :** \`${total}\``,
    `${dot} **Today (UTC) :** \`${today}\``,
    `${dot} **Server Rank :** \`#${rank}\``,
    "",
    "-# Counted from when the bot started tracking messages.",
  ]);
}

function respondAfk(message: Message, args: string[]) {
  const guildId = message.guild!.id;
  const userId = message.author.id;
  const first = args[0]?.toLowerCase();

  if (first === "off" || first === "remove" || first === "clear") {
    delete store.afkServer[`${guildId}:${userId}`];
    delete store.afkGlobal[userId];
    scheduleSave();
    return card(message, "AFK", ["Your AFK has been removed."]);
  }

  let scope: "server" | "global" = "server";
  let rest = args;
  if (first === "global" || first === "g") {
    scope = "global";
    rest = args.slice(1);
  } else if (first === "server" || first === "s") {
    rest = args.slice(1);
  }

  const reason = cleanText(rest.join(" "), 100) || "AFK";
  const entry: AfkEntry = { reason, since: Date.now() };

  if (scope === "global") {
    store.afkGlobal[userId] = entry;
  } else {
    store.afkServer[`${guildId}:${userId}`] = entry;
  }
  scheduleSave();

  return card(message, "AFK", [
    `${dot} **Mode :** \`${scope === "global" ? "Global (all servers)" : "Server only"}\``,
    `${dot} **Reason :** ${reason}`,
    "",
    "-# Send any message to remove your AFK. Use `!afk off` to remove it manually.",
  ]);
}

function respondLastPing(message: Message) {
  const guildId = message.guild!.id;
  const ping = store.lastPing[`${guildId}:${message.author.id}`];

  if (!ping) {
    return card(message, "Last Ping", [
      "Nobody has pinged you since I started tracking.",
    ]);
  }

  return card(message, "Last Ping", [
    `${dot} **Pinged By :** <@${ping.authorId}>`,
    `${dot} **Channel :** <#${ping.channelId}>`,
    `${dot} **When :** <t:${unix(ping.at)}:F> (<t:${unix(ping.at)}:R>)`,
    `${dot} **Message :** ${ping.content || "*(no text)*"}`,
    `${dot} **Jump :** https://discord.com/channels/${guildId}/${ping.channelId}/${ping.messageId}`,
  ]);
}

/* ------------------------------------------------------------------ */
/*  COZ economy (per server, like OwO's cowoncy)                        */
/* ------------------------------------------------------------------ */

const cozIcon = "🪙";
const startingCoz = 100;
const maxBet = 50_000;
const gambleCooldownMs = 4_000;
const gambleCooldowns = new Map<string, number>();

function fmt(amount: number) {
  return amount.toLocaleString("en-US");
}

function cozAccount(guildId: string, userId: string): CozAccount {
  const key = `${guildId}:${userId}`;
  let account = store.coz[key];
  if (!account) {
    account = { balance: startingCoz, lastDaily: 0, streak: 0 };
    store.coz[key] = account;
  }
  return account;
}

async function respondCoz(message: Message, args: string[]) {
  const user = await resolveTarget(message, args);
  const account = cozAccount(message.guild!.id, user.id);
  scheduleSave();
  return card(message, "COZ", [
    `${dot} **User :** ${user}`,
    `${dot} **Balance :** ${cozIcon} \`${fmt(account.balance)}\` coz`,
  ]);
}

function respondDaily(message: Message) {
  const account = cozAccount(message.guild!.id, message.author.id);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (now - account.lastDaily < dayMs) {
    const next = unix(account.lastDaily + dayMs);
    return card(message, "Daily", [
      `You already claimed your daily. Come back <t:${next}:R>.`,
    ]);
  }

  account.streak = now - account.lastDaily < dayMs * 2 ? account.streak + 1 : 1;
  const reward = 250 + Math.min(account.streak, 10) * 25;
  account.balance += reward;
  account.lastDaily = now;
  scheduleSave();

  return card(message, "Daily", [
    `${dot} **Reward :** ${cozIcon} \`${fmt(reward)}\` coz`,
    `${dot} **Streak :** \`${account.streak}\` day(s)`,
    `${dot} **Balance :** ${cozIcon} \`${fmt(account.balance)}\` coz`,
  ]);
}

function parseAmount(args: string[], balance: number): number | null {
  const raw = args.find((arg) => /^\d+$/.test(arg) || arg.toLowerCase() === "all");
  if (!raw) {
    return null;
  }
  const amount = raw.toLowerCase() === "all" ? balance : Number(raw);
  return Number.isSafeInteger(amount) ? amount : null;
}

function respondGive(message: Message, args: string[]) {
  const guildId = message.guild!.id;
  const botId = message.client.user?.id;
  const target = message.mentions.users.find((user) => user.id !== botId);

  if (!target || target.bot || target.id === message.author.id) {
    return card(message, "Give", ["Usage: `!give @user <amount>` (not yourself, not a bot)"]);
  }

  const sender = cozAccount(guildId, message.author.id);
  const amount = parseAmount(args, sender.balance);
  if (!amount || amount <= 0) {
    return card(message, "Give", ["Usage: `!give @user <amount>`"]);
  }
  if (amount > sender.balance) {
    return card(message, "Give", [
      `You only have ${cozIcon} \`${fmt(sender.balance)}\` coz.`,
    ]);
  }

  const receiver = cozAccount(guildId, target.id);
  sender.balance -= amount;
  receiver.balance += amount;
  scheduleSave();

  return card(message, "Give", [
    `${dot} ${message.author} sent ${cozIcon} \`${fmt(amount)}\` coz to ${target}`,
    `${dot} **Your Balance :** ${cozIcon} \`${fmt(sender.balance)}\` coz`,
  ]);
}

function checkGamble(message: Message, args: string[], title: string) {
  const key = `${message.guild!.id}:${message.author.id}`;
  const now = Date.now();
  const last = gambleCooldowns.get(key) ?? 0;
  if (now - last < gambleCooldownMs) {
    void card(message, title, ["Slow down! Try again in a few seconds."]);
    return null;
  }

  const account = cozAccount(message.guild!.id, message.author.id);
  const amount = parseAmount(args, Math.min(account.balance, maxBet));
  if (!amount || amount <= 0) {
    void card(message, title, [`Usage: \`!${title.toLowerCase()} <amount|all>\``]);
    return null;
  }
  if (amount > maxBet) {
    void card(message, title, [`Max bet is ${cozIcon} \`${fmt(maxBet)}\` coz.`]);
    return null;
  }
  if (amount > account.balance) {
    void card(message, title, [
      `You only have ${cozIcon} \`${fmt(account.balance)}\` coz.`,
    ]);
    return null;
  }

  gambleCooldowns.set(key, now);
  return { account, amount };
}

function respondCoinflip(message: Message, args: string[]) {
  const checked = checkGamble(message, args, "Coinflip");
  if (!checked) {
    return;
  }
  const { account, amount } = checked;

  const choice = args.some((arg) => ["t", "tails"].includes(arg.toLowerCase()))
    ? "tails"
    : "heads";
  const result = Math.random() < 0.5 ? "heads" : "tails";
  const won = choice === result;
  account.balance += won ? amount : -amount;
  scheduleSave();

  return card(message, "Coinflip", [
    `${dot} **You picked :** \`${choice}\``,
    `${dot} **Result :** \`${result}\``,
    won
      ? `You won ${cozIcon} \`${fmt(amount)}\` coz!`
      : `You lost ${cozIcon} \`${fmt(amount)}\` coz.`,
    `${dot} **Balance :** ${cozIcon} \`${fmt(account.balance)}\` coz`,
  ]);
}

function respondSlots(message: Message, args: string[]) {
  const checked = checkGamble(message, args, "Slots");
  if (!checked) {
    return;
  }
  const { account, amount } = checked;

  const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
  const reels = [0, 1, 2].map(
    () => symbols[Math.floor(Math.random() * symbols.length)],
  );
  const [a, b, c] = reels;

  let multiplier = 0;
  if (a === b && b === c) {
    multiplier = a === "7️⃣" ? 10 : 5;
  } else if (a === b || b === c || a === c) {
    multiplier = 1.5;
  }

  const payout = Math.floor(amount * multiplier);
  account.balance += payout - amount;
  scheduleSave();

  return card(message, "Slots", [
    `# ${reels.join(" | ")}`,
    payout > 0
      ? `You won ${cozIcon} \`${fmt(payout)}\` coz! (x${multiplier})`
      : `You lost ${cozIcon} \`${fmt(amount)}\` coz.`,
    `${dot} **Balance :** ${cozIcon} \`${fmt(account.balance)}\` coz`,
  ]);
}

function respondCozLeaderboard(message: Message) {
  const prefix = `${message.guild!.id}:`;
  const top = Object.entries(store.coz)
    .filter(([key]) => key.startsWith(prefix))
    .sort((left, right) => right[1].balance - left[1].balance)
    .slice(0, 10);

  if (top.length === 0) {
    return card(message, "COZ Leaderboard", ["Nobody has any coz yet."]);
  }

  return card(
    message,
    "COZ Leaderboard",
    top.map(
      ([key, account], index) =>
        `**#${index + 1}** <@${key.slice(prefix.length)}> - ${cozIcon} \`${fmt(account.balance)}\``,
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  Reset commands (Manage Server only)                                 */
/* ------------------------------------------------------------------ */

async function respondReset(
  message: Message,
  command: "resetinvites" | "resetmessages" | "resetcoz",
  args: string[],
) {
  const guildId = message.guild!.id;

  if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return card(message, "Reset", [
      "You need the **Manage Server** permission to use this command.",
    ]);
  }

  const labels = {
    resetinvites: "Invites",
    resetmessages: "Messages",
    resetcoz: "COZ",
  } as const;
  const label = labels[command];
  const bucket: Record<string, unknown> =
    command === "resetinvites"
      ? store.inviteStats
      : command === "resetmessages"
        ? store.messages
        : store.coz;

  const wantsAll = args.some((arg) => arg.toLowerCase() === "all");
  const botId = message.client.user?.id;
  const mentioned = message.mentions.users.find((user) => user.id !== botId);
  const idArg = args.find((arg) => /^\d{17,20}$/.test(arg));
  const targetId = mentioned?.id ?? idArg;

  if (wantsAll) {
    const prefix = `${guildId}:`;
    let removed = 0;
    for (const key of Object.keys(bucket)) {
      if (key.startsWith(prefix)) {
        delete bucket[key];
        removed += 1;
      }
    }
    scheduleSave();
    return card(message, `Reset ${label}`, [
      `${dot} Reset **${label}** for everyone in this server (\`${removed}\` record(s) cleared).`,
    ]);
  }

  if (targetId) {
    const existed = delete bucket[`${guildId}:${targetId}`];
    scheduleSave();
    return card(message, `Reset ${label}`, [
      `${dot} Reset **${label}** for <@${targetId}>.`,
      existed ? "" : "-# They had no saved data.",
    ].filter(Boolean));
  }

  return card(message, `Reset ${label}`, [
    `Usage: \`!${command} @user\` or \`!${command} all\``,
  ]);
}
