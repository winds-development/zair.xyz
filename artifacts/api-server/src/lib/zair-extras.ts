import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ChannelType,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  version as djsVersion,
  type Client,
  type Guild,
  type Invite,
  type Message,
  type User,
} from "discord.js";
import { logger } from "./logger";

export const DEFAULT_PREFIX = "-";
export const prefixContext = new AsyncLocalStorage<{ prefix: string }>();

/** Prefix of the server the current message/interaction came from. */
export function cmdPrefix(): string {
  return prefixContext.getStore()?.prefix ?? DEFAULT_PREFIX;
}

export function getPrefix(guildId?: string | null): string {
  return (guildId ? store.prefixes[guildId] : undefined) ?? DEFAULT_PREFIX;
}

export function flushExtras() {
  saveNow();
}

let extrasClient: Client | null = null;

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
  rinfo: "roleinfo",
  ci: "channelinfo",
  mc: "membercount",
  rl: "roles",
  em: "emojis",
  sicon: "servericon",
  sbanner: "serverbanner",
  lk: "lock",
  ulk: "unlock",
  sm: "slowmode",
  nn: "nick",
  prefix: "setprefix",
  sp: "setprefix",
  ui: "userinfo",
  whois: "userinfo",
  av: "avatar",
  pfp: "avatar",
  bn: "banner",
  sn: "snipe",
  es: "editsnipe",
  rem: "remind",
  bd: "birthday",
  bds: "birthdays",
  bi: "botinfo",
  addbot: "invite",
  pl: "poll",
  math: "calc",
  tr: "translate",
  wt: "weather",
  pick: "choose",
  "8b": "8ball",
  fl: "flip",
  dice: "roll",
  stl: "steal",
  yoink: "steal",
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
  "setprefix",
  "roleinfo",
  "channelinfo",
  "membercount",
  "roles",
  "emojis",
  "servericon",
  "serverbanner",
  "lock",
  "unlock",
  "slowmode",
  "nick",
  "userinfo",
  "avatar",
  "banner",
  "snipe",
  "editsnipe",
  "remind",
  "birthday",
  "birthdays",
  "botinfo",
  "invite",
  "poll",
  "calc",
  "translate",
  "weather",
  "qr",
  "choose",
  "8ball",
  "flip",
  "roll",
  "steal",
]);

// These work in DMs too; everything else needs a server.
const dmFriendlyCommands = new Set([
  "botinfo", "invite", "calc", "translate", "weather", "qr",
  "choose", "8ball", "flip", "roll", "remind", "birthday",
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

type Reminder = {
  id: string;
  userId: string;
  channelId: string;
  text: string;
  at: number;
};

type CozAccount = { balance: number; lastDaily: number; streak: number };

type Store = {
  afkGlobal: Record<string, AfkEntry>;
  afkServer: Record<string, AfkEntry>;
  messages: Record<string, MessageStat>;
  inviterOf: Record<string, InviterRecord>;
  inviteStats: Record<string, InviteStat>;
  lastPing: Record<string, LastPing>;
  coz: Record<string, CozAccount>;
  prefixes: Record<string, string>;
  birthdays: Record<string, { day: number; month: number }>;
  reminders: Reminder[];
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
    prefixes: {},
    birthdays: {},
    reminders: [],
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
  extrasClient = client;
  await loadStore();

  for (const reminder of store.reminders) {
    scheduleReminder(reminder);
  }

  client.on(Events.MessageDelete, (message) => {
    if (!message.guild || message.author?.bot || !message.author) {
      return;
    }
    deletedMessages.set(message.channelId, {
      authorId: message.author.id,
      content: cleanText(message.content ?? "", 300),
      at: Date.now(),
      attachments: message.attachments?.size ?? 0,
    });
  });

  client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot || !newMessage.author) {
      return;
    }
    if (oldMessage.content === newMessage.content) {
      return;
    }
    editedMessages.set(newMessage.channelId, {
      authorId: newMessage.author.id,
      before: cleanText(oldMessage.content ?? "", 300),
      after: cleanText(newMessage.content ?? "", 300),
      at: Date.now(),
    });
  });

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

function isAfkCommand(content: string, prefix: string) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(<@!?\\d+>\\s*)?${escaped}\\s*afk\\b`, "i").test(content.trim());
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
  if (!isAfkCommand(message.content, getPrefix(guildId))) {
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

function card(message: Message, title: string, lines: string[], images: string[] = []) {
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
          ...(images.length
            ? [{ type: 12, items: images.map((url) => ({ media: { url } })) }]
            : []),
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
  if (!message.guild && !dmFriendlyCommands.has(command)) {
    await message.reply("This command only works inside a server.").catch(() => undefined);
    return;
  }

  switch (command) {
    case "setprefix": return respondSetPrefix(message, args);
    case "roleinfo": return respondRoleInfo(message, args);
    case "channelinfo": return respondChannelInfo(message);
    case "membercount": return respondMemberCount(message);
    case "roles": return respondRoles(message, args);
    case "emojis": return respondEmojis(message);
    case "servericon": return respondServerImage(message, "icon");
    case "serverbanner": return respondServerImage(message, "banner");
    case "lock": return respondLock(message, args, true);
    case "unlock": return respondLock(message, args, false);
    case "slowmode": return respondSlowmode(message, args);
    case "nick": return respondNick(message, args);
    case "userinfo": return respondUserInfo(message, args);
    case "avatar": return respondAvatar(message, args);
    case "banner": return respondBanner(message, args);
    case "snipe": return respondSnipe(message, "snipe");
    case "editsnipe": return respondSnipe(message, "editsnipe");
    case "remind": return respondRemind(message, args);
    case "birthday": return respondBirthday(message, args);
    case "birthdays": return respondBirthdays(message);
    case "botinfo": return respondBotInfo(message);
    case "invite": return respondInvite(message);
    case "poll": return respondPoll(message, args);
    case "calc": return respondCalc(message, args);
    case "translate": return respondTranslate(message, args);
    case "weather": return respondWeather(message, args);
    case "qr": return respondQr(message, args);
    case "choose": return respondChoose(message, args);
    case "8ball": return respondEightBall(message, args);
    case "flip": return respondFlip(message);
    case "roll": return respondRoll(message, args);
    case "steal": return respondSteal(message, args);
    default:
      break;
  }

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
    `-# Send any message to remove your AFK. Use \`${cmdPrefix()}afk off\` to remove it manually.`,
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
    return card(message, "Give", [`Usage: \`${cmdPrefix()}give @user <amount>\` (not yourself, not a bot)`]);
  }

  const sender = cozAccount(guildId, message.author.id);
  const amount = parseAmount(args, sender.balance);
  if (!amount || amount <= 0) {
    return card(message, "Give", [`Usage: \`${cmdPrefix()}give @user <amount>\``]);
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
    void card(message, title, [`Usage: \`${cmdPrefix()}${title.toLowerCase()} <amount|all>\``]);
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
    `Usage: \`${cmdPrefix()}${command} @user\` or \`${cmdPrefix()}${command} all\``,
  ]);
}

/* ------------------------------------------------------------------ */
/*  Per-server prefix (default "-") and prefix-aware text               */
/* ------------------------------------------------------------------ */

async function respondSetPrefix(message: Message, args: string[]) {
  const guildId = message.guild!.id;
  const current = getPrefix(guildId);
  const wanted = args[0];

  if (!wanted) {
    return card(message, "Prefix", [
      `${dot} **Current prefix :** \`${current}\``,
      `${dot} **Change it :** \`${current}setprefix <new prefix>\``,
      `${dot} **Reset it :** \`${current}setprefix reset\``,
      `${dot} You can also mention me: ${message.client.user} help`,
    ]);
  }

  if (!(await needPermission(message, PermissionFlagsBits.ManageGuild, "Manage Server"))) {
    return;
  }

  if (wanted.toLowerCase() === "reset" || wanted.toLowerCase() === "default") {
    delete store.prefixes[guildId];
    scheduleSave();
    return card(message, "Prefix", [
      `${dot} Prefix reset to \`${DEFAULT_PREFIX}\` for this server.`,
    ]);
  }

  if (wanted.length > 5 || /[`\s<>@#]/.test(wanted)) {
    return card(message, "Prefix", [
      "A prefix can be 1 to 5 characters and cannot contain spaces, backticks, `<`, `>`, `@` or `#`.",
    ]);
  }

  store.prefixes[guildId] = wanted;
  scheduleSave();
  return card(message, "Prefix", [
    `${dot} Prefix for this server is now \`${wanted}\``,
    `${dot} Try \`${wanted}help\``,
  ]);
}

/* ------------------------------------------------------------------ */
/*  Shared helpers for the extra commands                               */
/* ------------------------------------------------------------------ */

async function needPermission(
  message: Message,
  flag: bigint,
  label: string,
): Promise<boolean> {
  if (message.member?.permissions.has(flag)) {
    return true;
  }
  await card(message, "No Permission", [
    `You need the **${label}** permission to use this command.`,
  ]);
  return false;
}

async function resolveMember(message: Message, user: User) {
  try {
    return await message.guild!.members.fetch(user.id);
  } catch {
    return null;
  }
}

function fmtDuration(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(" ");
}

function ts(ms: number) {
  return `<t:${unix(ms)}:F> (<t:${unix(ms)}:R>)`;
}

/* ------------------------------------------------------------------ */
/*  Server commands                                                    */
/* ------------------------------------------------------------------ */

function respondMemberCount(message: Message) {
  const guild = message.guild!;
  const lines = [`${dot} **Total Members :** \`${guild.memberCount}\``];
  if (guild.members.cache.size >= guild.memberCount) {
    const bots = guild.members.cache.filter((member) => member.user.bot).size;
    lines.push(
      `${dot} **Humans :** \`${guild.memberCount - bots}\``,
      `${dot} **Bots :** \`${bots}\``,
    );
  }
  return card(message, "Member Count", lines);
}

async function respondRoleInfo(message: Message, args: string[]) {
  const guild = message.guild!;
  const query = args.join(" ").trim().toLowerCase();
  const role =
    message.mentions.roles.first() ??
    guild.roles.cache.get(args[0] ?? "") ??
    guild.roles.cache.find((candidate) => candidate.name.toLowerCase() === query);

  if (!role) {
    return card(message, "Role Info", [
      `Usage: \`${cmdPrefix()}roleinfo @role\` (or the role name / ID)`,
    ]);
  }

  return card(message, "Role Info", [
    `${dot} **Role :** ${role}`,
    `${dot} **ID :** \`${role.id}\``,
    `${dot} **Color :** \`${role.hexColor}\``,
    `${dot} **Members :** \`${role.members.size}\``,
    `${dot} **Position :** \`${role.position}\``,
    `${dot} **Mentionable :** \`${role.mentionable ? "Yes" : "No"}\``,
    `${dot} **Hoisted :** \`${role.hoist ? "Yes" : "No"}\``,
    `${dot} **Created :** ${ts(role.createdTimestamp)}`,
  ]);
}

function respondChannelInfo(message: Message) {
  const channel = message.mentions.channels.first() ?? message.channel;
  const lines = [
    `${dot} **Channel :** <#${channel.id}>`,
    `${dot} **ID :** \`${channel.id}\``,
    `${dot} **Type :** \`${ChannelType[channel.type] ?? channel.type}\``,
  ];
  const created = "createdTimestamp" in channel ? channel.createdTimestamp : null;
  if (created) {
    lines.push(`${dot} **Created :** ${ts(created)}`);
  }
  if ("parent" in channel && channel.parent) {
    lines.push(`${dot} **Category :** ${channel.parent.name}`);
  }
  if ("topic" in channel && channel.topic) {
    lines.push(`${dot} **Topic :** ${cleanText(channel.topic, 200)}`);
  }
  if ("nsfw" in channel) {
    lines.push(`${dot} **NSFW :** \`${channel.nsfw ? "Yes" : "No"}\``);
  }
  if ("rateLimitPerUser" in channel && channel.rateLimitPerUser !== undefined) {
    lines.push(`${dot} **Slowmode :** \`${channel.rateLimitPerUser ?? 0}s\``);
  }
  return card(message, "Channel Info", lines);
}

async function respondRoles(message: Message, args: string[]) {
  const guild = message.guild!;
  const botId = message.client.user?.id;
  const mentioned = message.mentions.users.find((user) => user.id !== botId);
  const idArg = args.find((arg) => /^\d{17,20}$/.test(arg));

  if (mentioned || idArg) {
    const user = mentioned ?? (await message.client.users.fetch(idArg!).catch(() => null));
    const member = user ? await resolveMember(message, user) : null;
    if (!member) {
      return card(message, "Roles", ["I could not find that member."]);
    }
    const roles = member.roles.cache
      .filter((role) => role.id !== guild.id)
      .sort((left, right) => right.position - left.position);
    return card(message, "Roles", [
      `${dot} **Member :** ${member}`,
      `${dot} **Roles (${roles.size}) :** ${roles.size ? roles.map((role) => `<@&${role.id}>`).join(" ") : "None"}`,
    ]);
  }

  const roles = guild.roles.cache
    .filter((role) => role.id !== guild.id)
    .sort((left, right) => right.position - left.position);
  const shown = roles.first(40);
  const more = roles.size - shown.length;
  return card(message, "Server Roles", [
    `${dot} **Total :** \`${roles.size}\``,
    shown.map((role) => `<@&${role.id}>`).join(" ") || "No roles.",
    more > 0 ? `+${more} more` : "",
  ].filter(Boolean));
}

function respondEmojis(message: Message) {
  const emojis = message.guild!.emojis.cache;
  const animated = emojis.filter((emoji) => emoji.animated).size;
  const shown = [...emojis.values()].slice(0, 30).map((emoji) => `${emoji}`).join(" ");
  return card(message, "Server Emojis", [
    `${dot} **Total :** \`${emojis.size}\` (Animated \`${animated}\`, Static \`${emojis.size - animated}\`)`,
    shown || "This server has no custom emojis.",
  ]);
}

function respondServerImage(message: Message, kind: "icon" | "banner") {
  const guild = message.guild!;
  const url =
    kind === "icon"
      ? guild.iconURL({ size: 1024, extension: "png" })
      : guild.bannerURL({ size: 1024, extension: "png" });
  if (!url) {
    return card(message, kind === "icon" ? "Server Icon" : "Server Banner", [
      `This server has no ${kind}.`,
    ]);
  }
  return card(
    message,
    kind === "icon" ? "Server Icon" : "Server Banner",
    [`${dot} [Open full image](${url})`],
    [url],
  );
}

async function respondLock(message: Message, args: string[], lock: boolean) {
  if (!(await needPermission(message, PermissionFlagsBits.ManageChannels, "Manage Channels"))) {
    return;
  }
  const channel = message.mentions.channels.first() ?? message.channel;
  if (!("permissionOverwrites" in channel)) {
    return card(message, "Lock", ["I can only lock server text channels."]);
  }
  const reason = args.filter((arg) => !/^<#\d+>$/.test(arg)).join(" ");
  try {
    await channel.permissionOverwrites.edit(
      message.guild!.roles.everyone,
      { SendMessages: lock ? false : null },
      { reason: `${message.author.tag}: ${reason || (lock ? "Channel locked" : "Channel unlocked")}` },
    );
  } catch {
    return card(message, lock ? "Lock" : "Unlock", [
      "I could not change this channel. I need **Manage Channels** / **Manage Roles** there.",
    ]);
  }
  return card(message, lock ? "Channel Locked" : "Channel Unlocked", [
    `${dot} <#${channel.id}> is now ${lock ? "**locked** for @everyone" : "**unlocked** for @everyone"}.`,
    reason ? `${dot} **Reason :** ${cleanText(reason, 100)}` : "",
  ].filter(Boolean));
}

async function respondSlowmode(message: Message, args: string[]) {
  if (!(await needPermission(message, PermissionFlagsBits.ManageChannels, "Manage Channels"))) {
    return;
  }
  const channel = message.mentions.channels.first() ?? message.channel;
  const raw = args.find((arg) => /^\d+$/.test(arg) || arg.toLowerCase() === "off");
  if (!raw || !("setRateLimitPerUser" in channel)) {
    return card(message, "Slowmode", [
      `Usage: \`${cmdPrefix()}slowmode <seconds|off> [#channel]\` (0 - 21600)`,
    ]);
  }
  const seconds = raw.toLowerCase() === "off" ? 0 : Number(raw);
  if (seconds < 0 || seconds > 21600) {
    return card(message, "Slowmode", ["Slowmode must be between 0 and 21600 seconds."]);
  }
  try {
    await channel.setRateLimitPerUser(seconds, `Slowmode by ${message.author.tag}`);
  } catch {
    return card(message, "Slowmode", ["I could not change slowmode (missing permission)."]);
  }
  return card(message, "Slowmode", [
    seconds === 0
      ? `${dot} Slowmode turned **off** in <#${channel.id}>.`
      : `${dot} Slowmode in <#${channel.id}> set to \`${seconds}s\`.`,
  ]);
}

async function respondNick(message: Message, args: string[]) {
  if (!(await needPermission(message, PermissionFlagsBits.ManageNicknames, "Manage Nicknames"))) {
    return;
  }
  const botId = message.client.user?.id;
  const target = message.mentions.users.find((user) => user.id !== botId);
  if (!target) {
    return card(message, "Nickname", [`Usage: \`${cmdPrefix()}nick @user <new nickname|reset>\``]);
  }
  const member = await resolveMember(message, target);
  if (!member) {
    return card(message, "Nickname", ["I could not find that member."]);
  }
  const text = args
    .filter((arg) => !/^<@!?\d+>$/.test(arg))
    .join(" ")
    .trim();
  const nickname = !text || text.toLowerCase() === "reset" ? null : text;
  if (nickname && nickname.length > 32) {
    return card(message, "Nickname", ["Nicknames can be at most 32 characters."]);
  }
  try {
    await member.setNickname(nickname, `Nickname changed by ${message.author.tag}`);
  } catch {
    return card(message, "Nickname", [
      "I could not change that nickname. Their role may be higher than mine, or I lack **Manage Nicknames**.",
    ]);
  }
  return card(message, "Nickname", [
    nickname
      ? `${dot} Nickname for ${member} set to **${cleanText(nickname, 40)}**.`
      : `${dot} Nickname for ${member} was reset.`,
  ]);
}

/* ------------------------------------------------------------------ */
/*  User commands                                                      */
/* ------------------------------------------------------------------ */

async function respondUserInfo(message: Message, args: string[]) {
  const user = await resolveTarget(message, args);
  const member = await resolveMember(message, user);
  const lines = [
    `${dot} **User :** ${user} (\`${user.username}\`)`,
    `${dot} **ID :** \`${user.id}\``,
    `${dot} **Bot :** \`${user.bot ? "Yes" : "No"}\``,
    `${dot} **Account Created :** ${ts(user.createdTimestamp)}`,
  ];
  if (member) {
    if (member.joinedTimestamp) {
      lines.push(`${dot} **Joined Server :** ${ts(member.joinedTimestamp)}`);
    }
    if (member.nickname) {
      lines.push(`${dot} **Nickname :** ${cleanText(member.nickname, 40)}`);
    }
    const roles = member.roles.cache.filter((role) => role.id !== message.guild!.id);
    lines.push(
      `${dot} **Top Role :** ${roles.size ? `<@&${member.roles.highest.id}>` : "None"}`,
      `${dot} **Roles :** \`${roles.size}\``,
    );
    if (member.premiumSinceTimestamp) {
      lines.push(`${dot} **Boosting Since :** ${ts(member.premiumSinceTimestamp)}`);
    }
  }
  return card(
    message,
    "User Info",
    lines,
    [user.displayAvatarURL({ size: 512, extension: "png" })],
  );
}

async function respondAvatar(message: Message, args: string[]) {
  const user = await resolveTarget(message, args);
  const member = await resolveMember(message, user);
  const globalUrl = user.displayAvatarURL({ size: 1024, extension: "png" });
  const serverUrl = member?.avatarURL({ size: 1024, extension: "png" }) ?? null;
  const images = [globalUrl];
  const lines = [
    `${dot} **User :** ${user}`,
    `${dot} [Open avatar](${globalUrl})`,
  ];
  if (serverUrl && serverUrl !== globalUrl) {
    images.push(serverUrl);
    lines.push(`${dot} [Open server avatar](${serverUrl})`);
  }
  return card(message, "Avatar", lines, images);
}

async function respondBanner(message: Message, args: string[]) {
  const target = await resolveTarget(message, args);
  const user = await message.client.users.fetch(target.id, { force: true }).catch(() => target);
  const url = user.bannerURL({ size: 1024, extension: "png" });
  if (!url) {
    return card(message, "Banner", [`${dot} ${user} has no banner.`]);
  }
  return card(message, "Banner", [`${dot} **User :** ${user}`, `${dot} [Open banner](${url})`], [url]);
}

const deletedMessages = new Map<
  string,
  { authorId: string; content: string; at: number; attachments: number }
>();
const editedMessages = new Map<
  string,
  { authorId: string; before: string; after: string; at: number }
>();

function respondSnipe(message: Message, kind: "snipe" | "editsnipe") {
  if (kind === "snipe") {
    const entry = deletedMessages.get(message.channelId);
    if (!entry) {
      return card(message, "Snipe", ["Nothing to snipe in this channel."]);
    }
    return card(message, "Snipe", [
      `${dot} **Author :** <@${entry.authorId}>`,
      `${dot} **Deleted :** <t:${unix(entry.at)}:R>`,
      `${dot} **Message :** ${entry.content || "*(no text)*"}`,
      entry.attachments ? `${dot} **Attachments :** \`${entry.attachments}\`` : "",
    ].filter(Boolean));
  }
  const entry = editedMessages.get(message.channelId);
  if (!entry) {
    return card(message, "Edit Snipe", ["No edited messages to show in this channel."]);
  }
  return card(message, "Edit Snipe", [
    `${dot} **Author :** <@${entry.authorId}>`,
    `${dot} **Edited :** <t:${unix(entry.at)}:R>`,
    `${dot} **Before :** ${entry.before || "*(no text)*"}`,
    `${dot} **After :** ${entry.after || "*(no text)*"}`,
  ]);
}

function parseDuration(text: string): number | null {
  const pattern = /(\d+)\s*(w|d|h|m|s)/gi;
  const unitMs: Record<string, number> = {
    w: 604_800_000,
    d: 86_400_000,
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
  };
  let total = 0;
  let matched = "";
  for (const match of text.matchAll(pattern)) {
    total += Number(match[1]) * unitMs[match[2]!.toLowerCase()]!;
    matched += match[0];
  }
  return matched.length > 0 && matched.replace(/\s/g, "") === text.replace(/\s/g, "")
    ? total
    : null;
}

function scheduleReminder(reminder: Reminder) {
  const delay = Math.max(1_000, reminder.at - Date.now());
  const timer = setTimeout(async () => {
    store.reminders = store.reminders.filter((entry) => entry.id !== reminder.id);
    scheduleSave();
    const client = extrasClient;
    if (!client) {
      return;
    }
    const text = `<@${reminder.userId}> ⏰ **Reminder:** ${reminder.text}`;
    try {
      const channel = await client.channels.fetch(reminder.channelId);
      if (channel?.isSendable()) {
        await channel.send({ content: text, allowedMentions: { users: [reminder.userId] } });
        return;
      }
    } catch {
      // fall back to DM below
    }
    try {
      const user = await client.users.fetch(reminder.userId);
      await user.send(text);
    } catch {
      // user has DMs closed; nothing else we can do
    }
  }, delay);
  timer.unref();
}

async function respondRemind(message: Message, args: string[]) {
  const first = args[0]?.toLowerCase();
  const mine = store.reminders.filter((entry) => entry.userId === message.author.id);

  if (first === "list") {
    return card(
      message,
      "Reminders",
      mine.length
        ? mine.map(
            (entry, index) =>
              `${dot} **${index + 1}.** <t:${unix(entry.at)}:R> — ${cleanText(entry.text, 60)}`,
          )
        : ["You have no pending reminders."],
    );
  }
  if (first === "clear") {
    store.reminders = store.reminders.filter((entry) => entry.userId !== message.author.id);
    scheduleSave();
    return card(message, "Reminders", ["Your pending reminders were cleared (already-set timers will not send)."]);
  }

  const duration = first ? parseDuration(first) : null;
  const text = args.slice(1).join(" ").trim();
  if (!duration || !text) {
    return card(message, "Remind", [
      `Usage: \`${cmdPrefix()}remind <time> <text>\` — e.g. \`${cmdPrefix()}remind 10m drink water\` or \`${cmdPrefix()}remind 1h30m call mom\``,
      `Also: \`${cmdPrefix()}remind list\``,
    ]);
  }
  if (duration < 10_000 || duration > 7 * 86_400_000) {
    return card(message, "Remind", ["Time must be between 10 seconds and 7 days."]);
  }
  if (mine.length >= 10) {
    return card(message, "Remind", ["You can have at most 10 pending reminders."]);
  }

  const reminder: Reminder = {
    id: `${Date.now()}-${message.author.id}`,
    userId: message.author.id,
    channelId: message.channelId,
    text: cleanText(text, 300),
    at: Date.now() + duration,
  };
  store.reminders.push(reminder);
  scheduleSave();
  scheduleReminder(reminder);
  return card(message, "Remind", [
    `${dot} I will remind you <t:${unix(reminder.at)}:R>`,
    `${dot} **About :** ${reminder.text}`,
  ]);
}

const monthNames = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parseBirthday(text: string): { day: number; month: number } | null {
  const match = text.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || day < 1) {
    return null;
  }
  const daysInMonth = new Date(2024, month, 0).getDate(); // 2024 is a leap year
  return day <= daysInMonth ? { day, month } : null;
}

function daysUntilBirthday(birthday: { day: number; month: number }) {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let next = Date.UTC(now.getUTCFullYear(), birthday.month - 1, birthday.day);
  if (next < todayUtc) {
    next = Date.UTC(now.getUTCFullYear() + 1, birthday.month - 1, birthday.day);
  }
  return Math.round((next - todayUtc) / 86_400_000);
}

async function respondBirthday(message: Message, args: string[]) {
  const first = args[0]?.toLowerCase();

  if (first === "set") {
    const parsed = parseBirthday(args[1] ?? "");
    if (!parsed) {
      return card(message, "Birthday", [`Usage: \`${cmdPrefix()}birthday set DD-MM\` — e.g. \`${cmdPrefix()}birthday set 25-12\``]);
    }
    store.birthdays[message.author.id] = parsed;
    scheduleSave();
    return card(message, "Birthday", [
      `${dot} Your birthday is saved as **${parsed.day} ${monthNames[parsed.month - 1]}**.`,
    ]);
  }
  if (first === "remove" || first === "delete") {
    delete store.birthdays[message.author.id];
    scheduleSave();
    return card(message, "Birthday", ["Your birthday was removed."]);
  }

  const user = await resolveTarget(message, args);
  const birthday = store.birthdays[user.id];
  if (!birthday) {
    return card(message, "Birthday", [
      user.id === message.author.id
        ? `You have not set your birthday. Use \`${cmdPrefix()}birthday set DD-MM\`.`
        : `${user} has not set a birthday.`,
    ]);
  }
  const days = daysUntilBirthday(birthday);
  return card(message, "Birthday", [
    `${dot} **User :** ${user}`,
    `${dot} **Birthday :** ${birthday.day} ${monthNames[birthday.month - 1]}`,
    `${dot} **Next one :** ${days === 0 ? "**Today! 🎉**" : `in \`${days}\` day(s)`}`,
  ]);
}

async function respondBirthdays(message: Message) {
  const guild = message.guild!;
  const ids = Object.keys(store.birthdays);
  let members: string[] = [];
  if (ids.length > 0) {
    try {
      const fetched = await guild.members.fetch({ user: ids.slice(0, 100) });
      members = [...fetched.keys()];
    } catch {
      members = ids.filter((id) => guild.members.cache.has(id));
    }
  }
  const upcoming = members
    .map((id) => ({ id, birthday: store.birthdays[id]! }))
    .map((entry) => ({ ...entry, days: daysUntilBirthday(entry.birthday) }))
    .sort((left, right) => left.days - right.days)
    .slice(0, 10);

  if (upcoming.length === 0) {
    return card(message, "Birthdays", [`No birthdays are saved in this server yet. Use \`${cmdPrefix()}birthday set DD-MM\`.`]);
  }
  return card(
    message,
    "Upcoming Birthdays",
    upcoming.map(
      (entry) =>
        `${dot} <@${entry.id}> — ${entry.birthday.day} ${monthNames[entry.birthday.month - 1]} (${entry.days === 0 ? "today 🎉" : `in ${entry.days}d`})`,
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  Utility commands                                                   */
/* ------------------------------------------------------------------ */

function respondBotInfo(message: Message) {
  const client = message.client;
  const users = client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0);
  return card(message, "Bot Info", [
    `${dot} **Name :** ${botLabel(message)}`,
    `${dot} **ID :** \`${client.user?.id}\``,
    `${dot} **Servers :** \`${client.guilds.cache.size}\``,
    `${dot} **Users :** \`${users.toLocaleString("en-US")}\``,
    `${dot} **Ping :** \`${Math.round(client.ws.ping)}ms\``,
    `${dot} **Uptime :** \`${fmtDuration(process.uptime())}\``,
    `${dot} **Prefix :** \`${getPrefix(message.guild?.id)}\``,
    `${dot} **Library :** \`discord.js ${djsVersion}\` on \`Node ${process.version}\``,
    `${dot} **Memory :** \`${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB\``,
  ]);
}

function respondInvite(message: Message) {
  const id = message.client.user?.id;
  return card(message, "Invite", [
    `${dot} [Add ${botLabel(message)} to your server](https://discord.com/oauth2/authorize?client_id=${id}&permissions=8&scope=bot%20applications.commands)`,
    `${dot} [Support server](https://dc.gg/winds.dev)`,
  ]);
}

const pollNumbers = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

async function respondPoll(message: Message, args: string[]) {
  const parts = args.join(" ").split("|").map((part) => part.trim()).filter(Boolean);
  const question = parts[0];
  if (!question) {
    return card(message, "Poll", [
      `Usage: \`${cmdPrefix()}poll <question>\` (👍 / 👎) or \`${cmdPrefix()}poll <question> | option 1 | option 2 ...\` (up to 9 options)`,
    ]);
  }
  const options = parts.slice(1, 10);
  const reactions = options.length >= 2 ? pollNumbers.slice(0, options.length) : ["👍", "👎"];
  const lines =
    options.length >= 2
      ? options.map((option, index) => `${pollNumbers[index]} ${cleanText(option, 100)}`)
      : ["👍 Yes", "👎 No"];

  const sent = await card(message, `Poll: ${cleanText(question, 150)}`, lines);
  if (sent) {
    for (const reaction of reactions) {
      await sent.react(reaction).catch(() => undefined);
    }
  }
}

function tokenize(expression: string) {
  const tokens: string[] = [];
  const pattern = /\s*(\d+\.?\d*|\.\d+|[a-z]+|[-+*/%^(),])/giy;
  let position = 0;
  while (position < expression.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(expression);
    if (!match) {
      if (expression.slice(position).trim() === "") {
        break;
      }
      throw new Error("bad character");
    }
    tokens.push(match[1]!.toLowerCase());
    position = pattern.lastIndex;
  }
  return tokens;
}

function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const functions: Record<string, (value: number) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    log: Math.log10,
    ln: Math.log,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      value = take() === "+" ? value + parseTerm() : value - parseTerm();
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const operator = take();
      const right = parsePower();
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return value;
  };
  const parsePower = (): number => {
    const base = parseUnary();
    if (peek() === "^") {
      take();
      return Math.pow(base, parsePower());
    }
    return base;
  };
  const parseUnary = (): number => {
    if (peek() === "-") {
      take();
      return -parseUnary();
    }
    if (peek() === "+") {
      take();
      return parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = (): number => {
    const token = take();
    if (token === undefined) {
      throw new Error("unexpected end");
    }
    if (token === "(") {
      const value = parseExpression();
      if (take() !== ")") {
        throw new Error("missing )");
      }
      return value;
    }
    if (token === "pi") {
      return Math.PI;
    }
    if (token === "e") {
      return Math.E;
    }
    const fn = functions[token];
    if (fn) {
      if (take() !== "(") {
        throw new Error("missing (");
      }
      const value = parseExpression();
      if (take() !== ")") {
        throw new Error("missing )");
      }
      return fn(value);
    }
    const number = Number(token);
    if (Number.isNaN(number)) {
      throw new Error("unknown token");
    }
    return number;
  };

  const result = parseExpression();
  if (index < tokens.length) {
    throw new Error("unexpected token");
  }
  return result;
}

function respondCalc(message: Message, args: string[]) {
  const expression = args.join(" ").trim();
  if (!expression || expression.length > 120) {
    return card(message, "Calculator", [
      `Usage: \`${cmdPrefix()}calc <expression>\` — e.g. \`${cmdPrefix()}calc (12 + 8) * 3 / 4\`, \`${cmdPrefix()}calc 2^10\`, \`${cmdPrefix()}calc sqrt(144)\``,
    ]);
  }
  try {
    const result = evaluateExpression(expression);
    if (!Number.isFinite(result)) {
      throw new Error("not finite");
    }
    return card(message, "Calculator", [
      `${dot} **Expression :** \`${cleanText(expression, 100)}\``,
      `${dot} **Result :** \`${Number(result.toPrecision(12))}\``,
    ]);
  } catch {
    return card(message, "Calculator", ["I could not calculate that expression."]);
  }
}

const languageNames: Record<string, string> = {
  english: "en", hindi: "hi", urdu: "ur", arabic: "ar", spanish: "es",
  french: "fr", german: "de", bengali: "bn", russian: "ru", japanese: "ja",
  korean: "ko", chinese: "zh", portuguese: "pt", turkish: "tr", italian: "it",
  indonesian: "id", tamil: "ta", telugu: "te", marathi: "mr", punjabi: "pa",
};

async function fetchJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, any>;
}

async function respondTranslate(message: Message, args: string[]) {
  const language = args[0]?.toLowerCase();
  const text = args.slice(1).join(" ").trim();
  if (!language || !text) {
    return card(message, "Translate", [
      `Usage: \`${cmdPrefix()}translate <language> <text>\` — e.g. \`${cmdPrefix()}translate hi good morning\` or \`${cmdPrefix()}translate spanish how are you\``,
    ]);
  }
  const code = languageNames[language] ?? language;
  try {
    const data = await fetchJson(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 400))}&langpair=${encodeURIComponent(`Autodetect|${code}`)}`,
    );
    const translated = data["responseData"]?.["translatedText"];
    if (typeof translated !== "string" || !translated) {
      throw new Error("empty");
    }
    return card(message, "Translate", [
      `${dot} **To :** \`${code}\``,
      `${dot} **Original :** ${cleanText(text, 200)}`,
      `${dot} **Translation :** ${cleanText(translated, 400)}`,
    ]);
  } catch {
    return card(message, "Translate", [
      "I could not translate that. Check the language (use a code like `hi`, `es`, `fr`) and try again.",
    ]);
  }
}

async function respondWeather(message: Message, args: string[]) {
  const city = args.join(" ").trim();
  if (!city) {
    return card(message, "Weather", [`Usage: \`${cmdPrefix()}weather <city>\` — e.g. \`${cmdPrefix()}weather Mumbai\``]);
  }
  try {
    const data = await fetchJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const now = data["current_condition"]?.[0];
    const area = data["nearest_area"]?.[0];
    if (!now) {
      throw new Error("no data");
    }
    const place = [area?.["areaName"]?.[0]?.["value"], area?.["country"]?.[0]?.["value"]]
      .filter(Boolean)
      .join(", ");
    return card(message, `Weather - ${place || cleanText(city, 40)}`, [
      `${dot} **Condition :** ${now["weatherDesc"]?.[0]?.["value"] ?? "Unknown"}`,
      `${dot} **Temperature :** \`${now["temp_C"]}°C\` (feels like \`${now["FeelsLikeC"]}°C\`)`,
      `${dot} **Humidity :** \`${now["humidity"]}%\``,
      `${dot} **Wind :** \`${now["windspeedKmph"]} km/h\``,
      `${dot} **Pressure :** \`${now["pressure"]} hPa\``,
    ]);
  } catch {
    return card(message, "Weather", ["I could not find weather for that place right now."]);
  }
}

function respondQr(message: Message, args: string[]) {
  const text = args.join(" ").trim();
  if (!text || text.length > 500) {
    return card(message, "QR Code", [`Usage: \`${cmdPrefix()}qr <text or link>\` (max 500 characters)`]);
  }
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
  return card(message, "QR Code", [`${dot} **Data :** ${cleanText(text, 100)}`], [url]);
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function respondChoose(message: Message, args: string[]) {
  const options = args
    .join(" ")
    .split(/[|,]/)
    .map((option) => option.trim())
    .filter(Boolean);
  if (options.length < 2) {
    return card(message, "Choose", [`Usage: \`${cmdPrefix()}choose pizza | burger | pasta\` (separate options with \`|\` or \`,\`)`]);
  }
  return card(message, "Choose", [`${dot} I choose: **${cleanText(pickRandom(options), 100)}**`]);
}

function respondEightBall(message: Message, args: string[]) {
  if (args.length === 0) {
    return card(message, "8Ball", [`Usage: \`${cmdPrefix()}8ball <question>\``]);
  }
  const answers = [
    "It is certain.", "Without a doubt.", "Yes, definitely.", "Most likely.",
    "Signs point to yes.", "Reply hazy, try again.", "Ask again later.",
    "Better not tell you now.", "Don't count on it.", "My sources say no.",
    "Very doubtful.", "Outlook not so good.",
  ];
  return card(message, "8Ball", [
    `${dot} **Question :** ${cleanText(args.join(" "), 150)}`,
    `${dot} **Answer :** ${pickRandom(answers)}`,
  ]);
}

function respondFlip(message: Message) {
  return card(message, "Coin Flip", [`${dot} It landed on **${Math.random() < 0.5 ? "Heads" : "Tails"}**!`]);
}

function respondRoll(message: Message, args: string[]) {
  const raw = (args[0] ?? "6").toLowerCase();
  const match = raw.match(/^(?:(\d{1,2})d)?(\d{1,4})$/);
  if (!match) {
    return card(message, "Roll", [`Usage: \`${cmdPrefix()}roll [sides]\` or \`${cmdPrefix()}roll 2d6\``]);
  }
  const count = Math.min(20, Math.max(1, Number(match[1] ?? 1)));
  const sides = Math.max(2, Math.min(1000, Number(match[2])));
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((sum, value) => sum + value, 0);
  return card(message, "Roll", [
    `${dot} **Dice :** \`${count}d${sides}\``,
    `${dot} **Rolls :** ${rolls.join(", ")}`,
    `${dot} **Total :** \`${total}\``,
  ]);
}

async function respondSteal(message: Message, args: string[]) {
  if (!(await needPermission(message, PermissionFlagsBits.ManageGuildExpressions, "Manage Expressions"))) {
    return;
  }
  let source = args.join(" ");
  if (message.reference?.messageId) {
    const replied = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);
    source += ` ${replied?.content ?? ""}`;
  }
  const found = [...source.matchAll(/<(a?):(\w{2,32}):(\d{17,20})>/g)].slice(0, 5);
  if (found.length === 0) {
    return card(message, "Steal Emoji", [
      `Usage: \`${cmdPrefix()}steal <custom emoji> [more emojis]\` — or reply to a message that has emojis with \`${cmdPrefix()}steal\`.`,
    ]);
  }
  const added: string[] = [];
  const failed: string[] = [];
  for (const [, animated, name, id] of found) {
    try {
      const emoji = await message.guild!.emojis.create({
        attachment: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`,
        name: name!,
        reason: `Emoji stolen by ${message.author.tag}`,
      });
      added.push(`${emoji}`);
    } catch {
      failed.push(name!);
    }
  }
  return card(message, "Steal Emoji", [
    added.length ? `${dot} **Added :** ${added.join(" ")}` : "",
    failed.length ? `${dot} **Failed :** ${failed.join(", ")} (no free slots or missing permission)` : "",
  ].filter(Boolean));
}
