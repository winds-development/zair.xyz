import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type GuildMember,
  type PartialGuildMember,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { logger } from "./logger";
import {
  cmdPrefix,
  flushExtras,
  getPrefix,
  initExtras,
  isExtraCommand,
  prefixContext,
  resolveCommandAlias,
  respondToExtraCommand,
  trackMessage,
} from "./zair-extras";

// Live reference to the running Discord client, so every message uses the
// bot's CURRENT name (change it in the Discord Developer Portal and it follows).
let activeClient: Client | null = null;
let botStarted = false;
let botReady = false;

export function getBotStatus() {
  const client = activeClient;
  return {
    ready: botReady && Boolean(client?.isReady()),
    user: client?.user?.tag ?? null,
    guilds: client?.guilds.cache.size ?? 0,
    pingMs: client && client.ws.ping >= 0 ? Math.round(client.ws.ping) : null,
  };
}

export async function stopRazeBot() {
  botReady = false;
  flushExtras();
  if (activeClient) {
    try {
      await activeClient.destroy();
      logger.info("ZAIR Discord client destroyed (graceful shutdown)");
    } catch (error) {
      logger.warn({ err: error }, "ZAIR Discord client did not close cleanly");
    }
  }
}
const fallbackBotName = "ZAIR";

function botName(): string {
  const user = activeClient?.user;
  return user?.displayName || user?.username || fallbackBotName;
}

const token = process.env["DISCORD_BOT_TOKEN"];
const execFile = promisify(execFileCallback);
const embedColor = 0x2b2d31;
const redDotEmoji = "<:glowing_dot_red:1549131045876793545>";
const whiteDotEmoji = "<:glowing_dot_white:1550101471779889176>";
const statsDotEmoji = "<a:griffon_Cdot:1548626537660551208>";
const griffonStarEmoji = "<a:griffon_star:1550835256171569253>";
const greenRoleIconEmoji = "<:GreenRoleIconIDS:1550843686525476964>";
const catNotedEmoji = "<:CatNoted:1550846257256206456>";
const houseEmoji = "<:House:1549133353297649677>";
const kingPepeEmoji = "<:KingPepe:1550498948765196331>";
const winterStarEmoji = "<:WinterStar:1550518998201012294>";
const pixelDiamondEmoji = "<:pixeldiamond:1550497907495538729>";
const diamondEmoji = "<:diamond:1550497739303944315>";
const redDiamondEmoji = "<:red_diamond:1550498209737220156>";
const whiteArrowEmoji = "<:WhiteArrow:1550497517605490830>";
const utilityArrowEmoji = "<:UtilityArrow:1550532064661606461>";
const redArrowEmoji = "<:RedArrow:1550497283437764670>";
const blackArrowEmoji = "<:BlackArrow:1550497589701509142>";
const protectedEventsPreviousEmoji = {
  id: "1500400948780994671",
  name: "Spotify_Previous",
};
const protectedEventsTrashEmoji = {
  id: "1550881879371153568",
  name: "Trash",
};
const protectedEventsNextEmoji = {
  id: "1550857059853934614",
  name: "Spotify_Next",
};
const helpPagesNextEmoji = {
  id: "1545369216729747527",
  name: "Spotify_Next",
};
const protectedEventsPerPage = 8;
const whitelistedMembersPerPage = 10;
const extraOwnerMaxSlots = 2;
const autoModChannelName = "raze-automod";
const autoModTimeoutMs = 10 * 60 * 1000;
const autoModDisabledGuilds = new Set<string>();
const autoModBannedWords = [
  "fuck",
  "fucking",
  "fucker",
  "sex",
  "sexual",
  "porn",
  "dick",
  "pussy",
] as const;
const autoModLinkPattern = /(?:https?:\/\/|www\.|discord\.gg\/)\S+/i;
const botOwnerUserId = "1384120939779854336";
const reactionTargetUserId = botOwnerUserId;
const reactionEmojis = [
  "<:Crown:1550798080301989970>",
  "<:FundedForYouDeveloper:1550798186883588197>",
  "<:62:1550798039088762950>",
] as const;
const ticketTypeLabels = {
  general: "General Support",
  partnership: "Partnership",
  report: "Report User",
  purchase: "Purchase Help",
  bug: "Bug Report",
} as const;
const displayTimeZone = "Asia/Kolkata";
const handledHelpRequestIds = new Set<string>();
const guildSecurityStates = new Map<string, GuildSecurityState>();
const ticketConfigs = new Map<string, TicketConfig>();
const ticketPanelDrafts = new Map<string, TicketPanelDraft>();
const premiumGrants = new Map<string, PremiumGrant>();
const noPrefixGrants = new Map<string, Date>();
const premiumExpiryTimers = new Map<string, NodeJS.Timeout>();
const welcomerChannels = new Map<string, string>();
const leaverChannels = new Map<string, string>();

type MemberEventCardKind = "welcome" | "leave";
type MemberEventMember = GuildMember | PartialGuildMember;

type AnimeEventCardDesign = {
  name: string;
  welcomeAsset: string;
  leaveAsset: string;
};

const animeEventCardDesigns: AnimeEventCardDesign[] = [
  {
    name: "Sakura Moon",
    welcomeAsset: "welcome-sakura.png",
    leaveAsset: "leave-sakura.png",
  },
  {
    name: "Neon Shinobi",
    welcomeAsset: "welcome-shinobi.png",
    leaveAsset: "leave-shinobi.png",
  },
  {
    name: "Ocean Spirit",
    welcomeAsset: "welcome-ocean.png",
    leaveAsset: "leave-ocean.png",
  },
  {
    name: "Crimson Hero",
    welcomeAsset: "welcome-crimson.png",
    leaveAsset: "leave-crimson.png",
  },
  {
    name: "Star Guardian",
    welcomeAsset: "welcome-star.png",
    leaveAsset: "leave-star.png",
  },
  {
    name: "Forest Mage",
    welcomeAsset: "welcome-forest.png",
    leaveAsset: "leave-forest.png",
  },
];

type GuildSecurityState = {
  enabled: boolean;
  whitelist: Set<string>;
  extraOwners: Set<string>;
};

type TicketType = keyof typeof ticketTypeLabels;

type PremiumGrant = {
  tierNumber: 1 | 2 | 3;
  tierName: string;
  durationLabel: string;
  expiresAt: Date;
};

type TicketButtonConfig = {
  label: string;
  emoji?: string;
  style: number;
  enabled: boolean;
};

type TicketPanelConfig = {
  heading: string;
  description: string;
  footer: string;
  color: number;
  logoUrl?: string;
  buttons: Record<TicketType, TicketButtonConfig>;
};

type TicketConfig = {
  categoryId?: string;
  supportRoleId?: string;
  logChannelId?: string;
  panel?: TicketPanelConfig;
};

type TicketPanelDraft = {
  heading: string;
  message: string;
  logoUrl?: string;
  buttons: Array<{
    label: string;
    emoji?: string;
    style?: number;
  }>;
  end: string;
};

const ticketButtonColorOptions = [
  { value: "blue", label: "Blue", style: 1, embedColor: 0x5865f2 },
  { value: "grey", label: "Grey", style: 2, embedColor: 0x2b2d31 },
  { value: "green", label: "Green", style: 3, embedColor: 0x57f287 },
  { value: "red", label: "Red", style: 4, embedColor: 0xed4245 },
] as const;

type TicketInfo = {
  ownerId: string;
  type: string;
  status: "open" | "closed";
  claimedBy?: string;
};

const protectedSecurityEvents = [
  "Guild Update",
  "Channel Created",
  "Channel Deleted",
  "Channel Updated",
  "Role Created",
  "Role Deleted",
  "Role Updated",
  "Guild Ban Added",
  "Guild Ban Removed",
  "Member Kicked",
  "Member Pruned",
  "Member Role Updated",
  "Member Updated",
  "Webhook Created",
  "Webhook Deleted",
  "Webhook Updated",
  "Bot Added",
  "Emoji Created",
  "Emoji Deleted",
  "Emoji Updated",
  "Sticker Created",
  "Sticker Deleted",
  "Sticker Updated",
  "Integration Updated",
] as const;

function messageMentionsUser(message: Message, userId: string) {
  return (
    message.mentions.users.has(userId) ||
    message.content.includes(`<@${userId}>`) ||
    message.content.includes(`<@!${userId}>`)
  );
}

function guildSecurityState(guildId: string) {
  const existing = guildSecurityStates.get(guildId);
  if (existing) {
    return existing;
  }

  const state: GuildSecurityState = {
    enabled: false,
    whitelist: new Set<string>(),
    extraOwners: new Set<string>(),
  };
  guildSecurityStates.set(guildId, state);
  return state;
}

function ticketConfig(guildId: string) {
  const existing = ticketConfigs.get(guildId);
  if (existing) {
    return existing;
  }

  const config: TicketConfig = {};
  ticketConfigs.set(guildId, config);
  return config;
}

function defaultTicketPanelConfig(): TicketPanelConfig {
  return {
    heading: `# ${botName()} Ticket System 🎫`,
    description: [
      "**Need help?** Select the ticket type below.",
      "A private channel will be created for you and the support team.",
    ].join("\n"),
    footer: `${botName()} Ticket System by ᗯɪɴᴅꜱ™`,
    color: embedColor,
    buttons: Object.fromEntries(
      Object.entries(ticketTypeLabels).map(([type, label]) => [
        type,
        {
          label,
          style: 2,
          enabled: true,
        },
      ]),
    ) as Record<TicketType, TicketButtonConfig>,
  };
}

function ticketPanelConfig(guildId: string) {
  const config = ticketConfig(guildId);
  if (!config.panel) {
    config.panel = defaultTicketPanelConfig();
  }
  return config.panel;
}

function ticketTopic(info: TicketInfo) {
  return [
    "RAZE_TICKET",
    `owner=${info.ownerId}`,
    `type=${info.type}`,
    `status=${info.status}`,
    `claimed=${info.claimedBy ?? ""}`,
  ].join("|");
}

function ticketInfo(channel: TextChannel): TicketInfo | undefined {
  if (!channel.topic?.startsWith("RAZE_TICKET|")) {
    return undefined;
  }

  const values = Object.fromEntries(
    channel.topic
      .split("|")
      .slice(1)
      .map((entry) => {
        const [key, ...parts] = entry.split("=");
        return [key, parts.join("=")];
      }),
  );
  if (
    !values.owner ||
    !values.type ||
    (values.status !== "open" && values.status !== "closed")
  ) {
    return undefined;
  }

  return {
    ownerId: values.owner,
    type: values.type,
    status: values.status,
    claimedBy: values.claimed || undefined,
  };
}

function ticketChannelForUser(guild: Message["guild"], userId: string) {
  return guild?.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText &&
      ticketInfo(channel)?.ownerId === userId &&
      ticketInfo(channel)?.status === "open",
  );
}

function isTicketStaff(
  guild: NonNullable<Message["guild"]>,
  userId: string,
) {
  const member = guild.members.cache.get(userId);
  const config = ticketConfig(guild.id);
  return Boolean(
    guild.ownerId === userId ||
      member?.permissions.has(PermissionFlagsBits.Administrator) ||
      (config.supportRoleId && member?.roles.cache.has(config.supportRoleId)),
  );
}

function ticketTypeLabel(type: string) {
  return ticketTypeLabels[type as keyof typeof ticketTypeLabels] ?? type;
}

function securityStatus(guildId: string) {
  return guildSecurityState(guildId).enabled ? "Active" : "Deactive";
}

function isServerAdministratorOrOwner(message: Message) {
  return Boolean(
    message.guild &&
      (message.guild.ownerId === message.author.id ||
        message.member?.permissions.has(PermissionFlagsBits.Administrator)),
  );
}

function userIdFromArgument(argument?: string) {
  const match = argument?.match(/^<@!?(\d+)>$/) ?? argument?.match(/^\d+$/);
  return match?.[1];
}

function securityFooter(guildName: string) {
  return `${botName()} by ᗯɪɴᴅꜱ™ | ${guildName}`;
}

function helpCommand() {
  return {
    name: "help",
    description: `Open the ${botName()} Help Centre`,
  };
}

function buildCategoryDetails(): Record<
  string,
  { title: string; lines: string[] }
> {
  return {
  bot: {
    title: "BOT CMD",
    lines: [
      "`/help` — open this Help Centre",
      `\`${cmdPrefix()}help\` — open this Help Centre with the prefix`,
      `\`${cmdPrefix()}ping\` or \`${cmdPrefix()}pong\` — show the current ping`,
      `\`${cmdPrefix()}premium\` — view ${botName()} premium tiers`,
      "",
      `Shortcuts: \`${cmdPrefix()}h\` help • \`${cmdPrefix()}st\` stats • \`${cmdPrefix()}pg\` ping • \`${cmdPrefix()}prem\` premium • \`${cmdPrefix()}ut\` uptime`,
    ],
  },
  server: {
    title: "SERVER CMD",
    lines: [
      `${whiteDotEmoji} \`${cmdPrefix()}serverinfo\` - (Show server info) • \`${cmdPrefix()}si\``,
      `${whiteDotEmoji} \`${cmdPrefix()}setprefix <new>\` - (Change this server's prefix, Manage Server) • \`${cmdPrefix()}prefix\``,
      `${whiteDotEmoji} \`${cmdPrefix()}membercount\` - (Total members) • \`${cmdPrefix()}mc\``,
      `${whiteDotEmoji} \`${cmdPrefix()}roles [@user]\` - (Server roles, or a member's roles) • \`${cmdPrefix()}rl\``,
      `${whiteDotEmoji} \`${cmdPrefix()}roleinfo @role\` - (Details of a role) • \`${cmdPrefix()}rinfo\``,
      `${whiteDotEmoji} \`${cmdPrefix()}channelinfo [#channel]\` - (Details of a channel) • \`${cmdPrefix()}ci\``,
      `${whiteDotEmoji} \`${cmdPrefix()}emojis\` - (List server emojis) • \`${cmdPrefix()}em\``,
      `${whiteDotEmoji} \`${cmdPrefix()}servericon\` - (Show the server icon) • \`${cmdPrefix()}sicon\``,
      `${whiteDotEmoji} \`${cmdPrefix()}serverbanner\` - (Show the server banner) • \`${cmdPrefix()}sbanner\``,
      `${whiteDotEmoji} \`${cmdPrefix()}lock [#channel]\` - (Lock a channel, Manage Channels) • \`${cmdPrefix()}lk\``,
      `${whiteDotEmoji} \`${cmdPrefix()}unlock [#channel]\` - (Unlock a channel) • \`${cmdPrefix()}ulk\``,
      `${whiteDotEmoji} \`${cmdPrefix()}slowmode <seconds/off>\` - (Set channel slowmode) • \`${cmdPrefix()}sm\``,
      `${whiteDotEmoji} \`${cmdPrefix()}nick @user <name/reset>\` - (Change a nickname, Manage Nicknames) • \`${cmdPrefix()}nn\``,
      `${whiteDotEmoji} \`${cmdPrefix()}invites [@user]\` - (How many people a user invited) • \`${cmdPrefix()}inv\``,
      `${whiteDotEmoji} \`${cmdPrefix()}inviter [@user]\` - (Who invited a user) • \`${cmdPrefix()}ir\``,
      `${whiteDotEmoji} \`${cmdPrefix()}messages [@user]\` - (Message count and rank) • \`${cmdPrefix()}ms\` \`${cmdPrefix()}msgs\``,
      `${whiteDotEmoji} \`${cmdPrefix()}resetinvites @user/all\` - (Reset invites, Manage Server) • \`${cmdPrefix()}ri\``,
      `${whiteDotEmoji} \`${cmdPrefix()}resetmessages @user/all\` - (Reset message counts) • \`${cmdPrefix()}rm\``,
    ],
  },
  security: {
    title: "Z+ SECURITY CMD",
    lines: [
      "Security utilities will live here.",
      "No additional security commands are active yet.",
    ],
  },
  moderation: {
    title: "MOD CMD",
    lines: [
      `${whiteDotEmoji} \`${cmdPrefix()}automod on/off\` - (Auto moderation for sv)`,
      `${whiteDotEmoji} \`${cmdPrefix()}ban\` - (Ban a sv user)`,
      `${whiteDotEmoji} \`${cmdPrefix()}kick\` - (Kick a sv user)`,
      `${whiteDotEmoji} \`${cmdPrefix()}mute\` - (Muts a sv user)`,
      `${whiteDotEmoji} \`${cmdPrefix()}unban\` - (unban a user)`,
      `${whiteDotEmoji} \`${cmdPrefix()}unmute\` - (unmute a user)`,
      `${whiteDotEmoji} \`${cmdPrefix()}rape\` - (Rape a sv user)`,
      "",
      `Shortcuts: \`${cmdPrefix()}am\` automod • \`${cmdPrefix()}b\` ban • \`${cmdPrefix()}k\` kick • \`${cmdPrefix()}mu\` mute • \`${cmdPrefix()}ub\` unban • \`${cmdPrefix()}um\` unmute`,
    ],
  },
  music: {
    title: "MUSIC CMD",
    lines: [
      "Music utilities will live here.",
      "No additional music commands are active yet.",
    ],
  },
  ticket: {
    title: "TICKET SYSTEM",
    lines: [
      `${whiteDotEmoji} \`${cmdPrefix()}ticket setup\` - (Set up the ticket system)`,
      `${whiteDotEmoji} \`${cmdPrefix()}ticket panel\` - (Send the ticket panel)`,
      `${whiteDotEmoji} \`${cmdPrefix()}ticket create\` - (Create a ticket)`,
      `${whiteDotEmoji} \`${cmdPrefix()}ticket close/reopen\` - (Change ticket status)`,
      `${whiteDotEmoji} \`${cmdPrefix()}ticket claim\` - (Claim a ticket)`,
      `${whiteDotEmoji} \`${cmdPrefix()}ticket transcript\` - (Save a transcript)`,
      "",
      `Shortcut: \`${cmdPrefix()}tk\` ticket`,
    ],
  },
  welcome: {
    title: "WELCOME SYSTEM",
    lines: [
      `${whiteDotEmoji} \`${cmdPrefix()}welcomer set\` - (Send anime welcome cards in this channel)`,
      `${whiteDotEmoji} \`${cmdPrefix()}welcomer remove\` - (Remove the welcome card channel)`,
      `${whiteDotEmoji} \`${cmdPrefix()}leaver set\` - (Send anime leave cards in this channel)`,
      `${whiteDotEmoji} \`${cmdPrefix()}leaver remove\` - (Remove the leave card channel)`,
      "",
      `Shortcuts: \`${cmdPrefix()}wc\` welcomer • \`${cmdPrefix()}lv\` leaver`,
    ],
  },
  user: {
    title: "USER SYSTEM",
    lines: [
      `${whiteDotEmoji} \`${cmdPrefix()}userinfo [@user]\` - (Info about a user) • \`${cmdPrefix()}ui\` \`${cmdPrefix()}whois\``,
      `${whiteDotEmoji} \`${cmdPrefix()}avatar [@user]\` - (Show an avatar) • \`${cmdPrefix()}av\` \`${cmdPrefix()}pfp\``,
      `${whiteDotEmoji} \`${cmdPrefix()}banner [@user]\` - (Show a profile banner) • \`${cmdPrefix()}bn\``,
      `${whiteDotEmoji} \`${cmdPrefix()}afk [global/server] [reason]\` - (Set AFK for this server or all servers)`,
      `${whiteDotEmoji} \`${cmdPrefix()}afk off\` - (Remove your AFK)`,
      `${whiteDotEmoji} \`${cmdPrefix()}lastping\` - (See who pinged you last) • \`${cmdPrefix()}lp\``,
      `${whiteDotEmoji} \`${cmdPrefix()}snipe\` - (Show the last deleted message) • \`${cmdPrefix()}sn\``,
      `${whiteDotEmoji} \`${cmdPrefix()}editsnipe\` - (Show the last edited message) • \`${cmdPrefix()}es\``,
      `${whiteDotEmoji} \`${cmdPrefix()}remind <time> <text>\` - (Set a reminder (10m, 2h, 1d)) • \`${cmdPrefix()}rem\``,
      `${whiteDotEmoji} \`${cmdPrefix()}birthday set DD-MM\` - (Save your birthday, or check someone's) • \`${cmdPrefix()}bd\``,
      `${whiteDotEmoji} \`${cmdPrefix()}birthdays\` - (Upcoming birthdays in this server) • \`${cmdPrefix()}bds\``,
    ],
  },
  coz: {
    title: "COZ SYSTEM",
    lines: [
      `${whiteDotEmoji} \`${cmdPrefix()}coz [@user]\` - (Check coz balance) • \`${cmdPrefix()}bal\` \`${cmdPrefix()}cash\``,
      `${whiteDotEmoji} \`${cmdPrefix()}daily\` - (Claim daily coz with streak bonus) • \`${cmdPrefix()}dl\``,
      `${whiteDotEmoji} \`${cmdPrefix()}give @user <amount>\` - (Send coz to someone) • \`${cmdPrefix()}pay\``,
      `${whiteDotEmoji} \`${cmdPrefix()}coinflip <amount> [h/t]\` - (Bet on a coin flip) • \`${cmdPrefix()}cf\``,
      `${whiteDotEmoji} \`${cmdPrefix()}slots <amount>\` - (Spin the slots) • \`${cmdPrefix()}sl\``,
      `${whiteDotEmoji} \`${cmdPrefix()}cozlb\` - (Server coz leaderboard) • \`${cmdPrefix()}lb\` \`${cmdPrefix()}top\``,
      `${whiteDotEmoji} \`${cmdPrefix()}resetcoz @user/all\` - (Reset coz, Manage Server) • \`${cmdPrefix()}rc\``,
    ],
  },
  utility: {
    title: "UTILITY",
    lines: [
      `${whiteDotEmoji} \`${cmdPrefix()}ping\` - (Show the bot ping) • \`${cmdPrefix()}pg\``,
      `${whiteDotEmoji} \`${cmdPrefix()}uptime\` - (Show bot uptime) • \`${cmdPrefix()}ut\``,
      `${whiteDotEmoji} \`${cmdPrefix()}botinfo\` - (Bot stats and info) • \`${cmdPrefix()}bi\``,
      `${whiteDotEmoji} \`${cmdPrefix()}invite\` - (Add the bot to your server) • \`${cmdPrefix()}addbot\``,
      `${whiteDotEmoji} \`${cmdPrefix()}say <message>\` - (Make the bot say something) • \`${cmdPrefix()}s\``,
      `${whiteDotEmoji} \`${cmdPrefix()}embed\` - (Build and send an embed) • \`${cmdPrefix()}e\``,
      `${whiteDotEmoji} \`${cmdPrefix()}dm\` - (Send a DM through the bot) • \`${cmdPrefix()}d\``,
      `${whiteDotEmoji} \`${cmdPrefix()}poll <question> | a | b\` - (Create a poll) • \`${cmdPrefix()}pl\``,
      `${whiteDotEmoji} \`${cmdPrefix()}calc <expression>\` - (Calculator) • \`${cmdPrefix()}math\``,
      `${whiteDotEmoji} \`${cmdPrefix()}translate <lang> <text>\` - (Translate text) • \`${cmdPrefix()}tr\``,
      `${whiteDotEmoji} \`${cmdPrefix()}weather <city>\` - (Current weather) • \`${cmdPrefix()}wt\``,
      `${whiteDotEmoji} \`${cmdPrefix()}qr <text>\` - (Make a QR code)`,
      `${whiteDotEmoji} \`${cmdPrefix()}choose a | b | c\` - (Pick one option) • \`${cmdPrefix()}pick\``,
      `${whiteDotEmoji} \`${cmdPrefix()}8ball <question>\` - (Ask the magic 8ball) • \`${cmdPrefix()}8b\``,
      `${whiteDotEmoji} \`${cmdPrefix()}flip\` - (Flip a coin) • \`${cmdPrefix()}fl\``,
      `${whiteDotEmoji} \`${cmdPrefix()}roll [sides / 2d6]\` - (Roll dice) • \`${cmdPrefix()}dice\``,
      `${whiteDotEmoji} \`${cmdPrefix()}steal <emoji>\` - (Copy a custom emoji, Manage Expressions) • \`${cmdPrefix()}stl\``,
    ],
  },
  };
}

function requesterLabel(user: {
  tag?: string;
  username: string;
  id: string;
}) {
  return user.tag ?? `${user.username} (${user.id})`;
}

type RawDiscordComponent = Record<string, unknown>;

function categorySelect(
  label: string,
  value: string,
  description: string,
): RawDiscordComponent {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `raze:help-category:${value}`,
        placeholder: label,
        min_values: 1,
        max_values: 1,
        options: [
          {
            label,
            description,
            value,
          },
        ],
      },
    ],
  };
}

function categorySelects(page: number): RawDiscordComponent[] {
  const pages = [
    [
      categorySelect("BOT CMD", "bot", "Bot and help commands"),
      categorySelect("SERVER CMD", "server", "Server information commands"),
      categorySelect(
        "Z+ SECURITY CMD",
        "security",
        "Security and protection commands",
      ),
      categorySelect("MOD CMD", "moderation", "Moderation commands"),
      categorySelect("MUSIC CMD", "music", "Music commands"),
    ],
    [
      categorySelect("TICKET SYSTEM", "ticket", "Ticket management commands"),
      categorySelect("WELCOME SYSTEM", "welcome", "Welcome message commands"),
      categorySelect("USER SYSTEM", "user", "User management commands"),
      categorySelect("UTILITY", "utility", "Utility commands"),
      categorySelect("COZ SYSTEM", "coz", "Coin economy commands"),
    ],
  ];

  const safePage = Math.max(0, Math.min(page, pages.length - 1));
  return pages[safePage];
}

function helpPageButtons(page: number): RawDiscordComponent {
  return paginationButtons("help-pages", page, 2, {
    previous: protectedEventsPreviousEmoji,
    trash: protectedEventsTrashEmoji,
    next: helpPagesNextEmoji,
  });
}

function separatorComponent(): RawDiscordComponent {
  return {
    type: 14,
    divider: true,
    spacing: 1,
  };
}

function headingComponent(
  content: string,
  imageUrl?: string,
): RawDiscordComponent {
  if (!imageUrl) {
    return textComponent(content);
  }

  const component: RawDiscordComponent = {
    type: 9,
    components: [textComponent(content)],
  };

  component.accessory = {
    type: 11,
    media: {
      url: imageUrl,
    },
  };

  return component;
}

function supportButtonComponent(): RawDiscordComponent {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 5,
        label: "ⓘ | Support",
        url: "https://dc.gg/winds.dev",
      },
    ],
  };
}

function razeAddedWelcomeComponents(
  guild: Pick<NonNullable<Message["guild"]>, "name" | "id">,
  avatarUrl: string,
): RawDiscordComponent[] {
  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(`## Thanks for adding ${botName()}!`),
        separatorComponent(),
        headingComponent(
          `Hello! I'm ${botName()}, your new multi-purpose assistant.`,
          avatarUrl,
        ),
        separatorComponent(),
        textComponent(
          [
            "**How to use me:**",
            `Use \`${cmdPrefix()}help\` to see all my commands.`,
            "Most administrative commands require `Manage Server` or `Administrator` permissions.",
            `If you need help, use \`${cmdPrefix()}help\` to see the available commands.`,
          ].join("\n"),
        ),
        separatorComponent(),
        textComponent(`Server: ${guild.name} (${guild.id})`),
      ],
    },
  ];
}

function razeLeftGuildComponents(
  guildName: string,
  avatarUrl: string,
): RawDiscordComponent[] {
  return [
    {
      type: 17,
      accent_color: 0xef4444,
      components: [
        textComponent(`## Goodbye from ${botName()}`),
        separatorComponent(),
        headingComponent(
          `I have been removed from your server: **${guildName}**.`,
          avatarUrl,
        ),
        separatorComponent(),
        textComponent(
          [
            `If this was a mistake, invite ${botName()} again and use \`${cmdPrefix()}help\`.`,
            "Thanks for having me.",
          ].join("\n"),
        ),
      ],
    },
  ];
}

function findAnnouncementChannel(
  guild: NonNullable<Message["guild"]>,
): TextChannel | undefined {
  if (guild.systemChannel?.isSendable()) {
    return guild.systemChannel;
  }

  return guild.channels.cache
    .filter(
      (channel): channel is TextChannel =>
        channel.type === ChannelType.GuildText && channel.isSendable(),
    )
    .sort((left, right) => left.rawPosition - right.rawPosition)
    .first();
}

function textComponent(content: string): RawDiscordComponent {
  return {
    type: 10,
    content,
  };
}

function animeEventDesignForMember(member: MemberEventMember) {
  const seed = `${member.guild.id}:${member.id}`;
  const hash = [...seed].reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return animeEventCardDesigns[hash % animeEventCardDesigns.length];
}

function xmlEscape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}

function ordinalSuffix(value: number) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return "TH";
  }
  return ({ 1: "ST", 2: "ND", 3: "RD" } as Record<number, string>)[
    value % 10
  ] ?? "TH";
}

function memberEventCardSvg(
  kind: MemberEventCardKind,
  member: MemberEventMember,
  avatarData: string,
) {
  const count = Math.max(1, member.guild.memberCount);
  const eventLabel = kind === "welcome" ? "WELCOME" : "GOODBYE";
  const countLabel = `${eventLabel} ${count}${ordinalSuffix(count)}`;
  const username = xmlEscape(
    (member.user.globalName ?? member.user.username)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24)
      .toUpperCase(),
  );

  return `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="675" viewBox="0 0 1200 675">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0.05"/>
          <stop offset="0.68" stop-color="#050816" stop-opacity="0.24"/>
          <stop offset="1" stop-color="#050816" stop-opacity="0.88"/>
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.8"/>
        </filter>
        <clipPath id="avatarClip">
          <circle cx="600" cy="250" r="108"/>
        </clipPath>
      </defs>
      <rect width="1200" height="675" fill="url(#shade)"/>
      <circle cx="600" cy="250" r="120" fill="#080b14" fill-opacity="0.82" filter="url(#shadow)"/>
      <image x="492" y="142" width="216" height="216" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${avatarData}" xlink:href="data:image/png;base64,${avatarData}" clip-path="url(#avatarClip)"/>
      <circle cx="600" cy="250" r="112" fill="none" stroke="#ffffff" stroke-width="8" stroke-opacity="0.95" filter="url(#shadow)"/>
      <text x="600" y="518" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="66" font-weight="900" letter-spacing="1" fill="#19e7ff" stroke="#08111f" stroke-width="12" paint-order="stroke" filter="url(#shadow)">${countLabel}</text>
      <text x="600" y="588" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="48" font-weight="900" letter-spacing="0.5" fill="#ffffff" stroke="#111827" stroke-width="10" paint-order="stroke" filter="url(#shadow)">${username}</text>
    </svg>
  `;
}

async function composeMemberEventCard(
  kind: MemberEventCardKind,
  member: MemberEventMember,
  design: AnimeEventCardDesign,
) {
  const tempDir = await mkdtemp(join(tmpdir(), "zair-member-card-"));
  try {
    const backgroundPath = join(
      tempDir,
      kind === "welcome" ? "welcome-background.png" : "leave-background.png",
    );
    const overlayPath = join(tempDir, "overlay.svg");
    const outputPath = join(tempDir, "card.png");
    const background = await readFile(
      new URL(
        `../assets/member-cards/${
          kind === "welcome" ? design.welcomeAsset : design.leaveAsset
        }`,
        import.meta.url,
      ),
    );
    const avatarUrl = member.user.displayAvatarURL({
      extension: "png",
      size: 256,
    });
    const avatarResponse = await fetch(avatarUrl);
    if (!avatarResponse.ok) {
      throw new Error(`Avatar download failed with ${avatarResponse.status}.`);
    }
    const avatar = Buffer.from(await avatarResponse.arrayBuffer());
    await writeFile(backgroundPath, background);
    await writeFile(
      overlayPath,
      memberEventCardSvg(kind, member, avatar.toString("base64")),
      "utf8",
    );
    await execFile("magick", [
      backgroundPath,
      "-resize",
      "1200x675^",
      "-gravity",
      "center",
      "-extent",
      "1200x675",
      overlayPath,
      "-composite",
      "-strip",
      outputPath,
    ]);
    return readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function configuredMemberEventChannel(
  guild: NonNullable<Message["guild"]>,
  channelId: string | undefined,
): TextChannel | undefined {
  if (!channelId) {
    return undefined;
  }

  const channel = guild.channels.cache.get(channelId);
  return channel?.type === ChannelType.GuildText && channel.isSendable()
    ? channel
    : undefined;
}

function memberEventSetupComponents(
  kind: MemberEventCardKind,
  action: "set" | "remove" | "error",
): RawDiscordComponent[] {
  const label = kind === "welcome" ? "Welcomer" : "Leaver";
  const status =
    action === "set"
      ? `${label} Enabled`
      : action === "remove"
        ? `${label} Disabled`
        : `${label} Error`;

  return [
    {
      type: 17,
      accent_color: action === "error" ? 0xef4444 : embedColor,
      components: [
        textComponent(`${botName()} - ${status}`),
      ],
    },
  ];
}

async function respondToMemberEventCommand(
  message: Message,
  args: string[],
  kind: MemberEventCardKind,
) {
  const label = kind === "welcome" ? "welcomer" : "leaver";
  const channels = kind === "welcome" ? welcomerChannels : leaverChannels;
  const action = args[0]?.toLowerCase();

  if (!message.guild) {
    await message.reply({
      flags: MessageFlags.IsComponentsV2,
      components: memberEventSetupComponents(kind, "error"),
    } as never);
    return;
  }

  if (!isServerAdministratorOrOwner(message)) {
    await message.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: 17,
          accent_color: 0xef4444,
          components: [
            textComponent(`## ${botName()} ${label} System`),
            separatorComponent(),
            textComponent(
              "Only the server owner or an administrator can configure this system.",
            ),
          ],
        },
      ],
    } as never);
    return;
  }

  if (action === "set") {
    if (message.channel.type !== ChannelType.GuildText) {
      await message.reply({
        flags: MessageFlags.IsComponentsV2,
        components: memberEventSetupComponents(kind, "error"),
      } as never);
      return;
    }

    channels.set(message.guild.id, message.channel.id);
    await message.reply({
      flags: MessageFlags.IsComponentsV2,
      components: memberEventSetupComponents(kind, "set"),
    } as never);
    return;
  }

  if (action === "remove") {
    channels.delete(message.guild.id);
    await message.reply({
      flags: MessageFlags.IsComponentsV2,
      components: memberEventSetupComponents(kind, "remove"),
    } as never);
    return;
  }

  await message.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        accent_color: embedColor,
        components: [
          textComponent(`## ${botName()} ${label} System`),
          separatorComponent(),
          textComponent(
            [
              `\`${cmdPrefix()}${label} set\` — use this channel for anime cards`,
              `\`${cmdPrefix()}${label} remove\` — disable this card system`,
            ].join("\n"),
          ),
        ],
      },
    ],
  } as never);
}

async function sendMemberEventCard(
  kind: MemberEventCardKind,
  member: MemberEventMember,
) {
  const configuredChannelId =
    kind === "welcome"
      ? welcomerChannels.get(member.guild.id)
      : leaverChannels.get(member.guild.id);
  const channel = configuredMemberEventChannel(
    member.guild,
    configuredChannelId,
  );
  if (!channel) {
    return;
  }

  try {
    const design = animeEventDesignForMember(member);
    const image = await composeMemberEventCard(kind, member, design);
    await channel.send({
      files: [
        {
          attachment: image,
          name: `zair-${kind}-card.png`,
        },
      ],
    });
    logger.info(
      {
        guildId: member.guild.id,
        channelId: channel.id,
        memberId: member.id,
        kind,
      },
      `${botName()} sent anime ${kind} card`,
    );
  } catch (error) {
    logger.warn(
      { err: error, guildId: member.guild.id, channelId: channel.id, kind },
      `${botName()} could not send anime ${kind} card`,
    );
  }
}

function ticketEmojiPayload(
  emoji: string,
  guild?: NonNullable<Message["guild"]>,
) {
  const value = emoji.trim();
  const customEmoji = value.match(
    /^<(?<animated>a)?:(?<name>[^:]+):(?<id>\d+)>$/,
  );
  if (customEmoji) {
    return {
      name: customEmoji.groups?.name,
      id: customEmoji.groups?.id,
      animated: Boolean(customEmoji.groups?.animated),
    };
  }

  const namedEmoji = value.match(/^:(?<name>[A-Za-z0-9_~-]+):$/);
  if (namedEmoji) {
    const guildEmoji = guild?.emojis.cache.find(
      (candidate) => candidate.name === namedEmoji.groups?.name,
    );
    return guildEmoji
      ? {
          name: guildEmoji.name,
          id: guildEmoji.id,
          animated: guildEmoji.animated,
        }
      : undefined;
  }

  if (value.startsWith("<") || (value.startsWith(":") && value.endsWith(":"))) {
    return undefined;
  }
  return value ? { name: value } : undefined;
}

function isTicketEmojiInput(value: string) {
  const trimmed = value.trim();
  return Boolean(
    /^<(?:(?:a)?:[^:]+:\d+)>$/.test(trimmed) ||
      /^:[A-Za-z0-9_~-]+:$/.test(trimmed) ||
      (trimmed.length <= 16 && /\p{Extended_Pictographic}/u.test(trimmed)),
  );
}

function ticketButtonEmojiFromText(value: string) {
  return (
    value.match(/<(?:(?:a)?:[^:]+:\d+)>/)?.[0] ??
    value.match(/:[A-Za-z0-9_~-]+:/)?.[0] ??
    value.match(
      /\p{Extended_Pictographic}(?:\uFE0F|\u20E3|\u200D\p{Extended_Pictographic})*/u,
    )?.[0]
  );
}

function ticketEmojiMarkup(
  emoji: string,
  guild?: NonNullable<Message["guild"]>,
) {
  const value = emoji.trim();
  const customEmoji = value.match(
    /^<(?<animated>a)?:(?<name>[^:]+):(?<id>\d+)>$/,
  );
  if (customEmoji) {
    return value;
  }

  const namedEmoji = value.match(/^:(?<name>[A-Za-z0-9_~-]+):$/);
  if (namedEmoji) {
    const guildEmoji = guild?.emojis.cache.find(
      (candidate) => candidate.name === namedEmoji.groups?.name,
    );
    return guildEmoji
      ? `<${guildEmoji.animated ? "a" : ""}:${guildEmoji.name}:${guildEmoji.id}>`
      : value;
  }

  return value;
}

function replaceNamedEmojiMarkup(
  content: string,
  guild?: NonNullable<Message["guild"]>,
) {
  return content.replace(
    /<(?:(?:a)?:[^:]+:\d+)>|:[A-Za-z0-9_~-]+:/g,
    (match) =>
      match.startsWith("<") ? match : ticketEmojiMarkup(match, guild),
  );
}

function ticketButton(
  customId: string,
  label: string,
  style = 2,
  emoji?: string,
  guild?: NonNullable<Message["guild"]>,
): RawDiscordComponent {
  const button: RawDiscordComponent = {
    type: 2,
    style,
    custom_id: customId,
  };
  if (label.trim()) {
    button.label = label.trim();
  }
  if (emoji) {
    const emojiPayload = ticketEmojiPayload(emoji, guild);
    if (emojiPayload) {
      button.emoji = emojiPayload;
    }
  }
  return button;
}

function ticketPanelComponents(guildId: string): RawDiscordComponent[] {
  const panel = ticketPanelConfig(guildId);
  const buttons = (Object.keys(ticketTypeLabels) as TicketType[])
    .filter((type) => panel.buttons[type].enabled)
    .map((type) => {
      const button = panel.buttons[type];
      return ticketButton(
        `raze:ticket:create:${type}`,
        button.label,
        button.style,
        button.emoji,
      );
    });
  const cardComponents: RawDiscordComponent[] = [
    textComponent(panel.heading),
    separatorComponent(),
    textComponent(panel.description),
    separatorComponent(),
  ];
  if (buttons.length > 0) {
    cardComponents.push({
      type: 1,
      components: buttons,
    });
    cardComponents.push(separatorComponent());
  } else {
    cardComponents.push(textComponent("Ticket creation is currently paused."));
    cardComponents.push(separatorComponent());
  }
  cardComponents.push(textComponent(panel.footer));

  return [
    {
      type: 17,
      accent_color: panel.color,
      components: cardComponents,
    },
  ];
}

function ticketPanelBuilderComponents(): RawDiscordComponent[] {
  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(`# ${botName()} - TICKET`),
        separatorComponent(),
        textComponent(
          [
            "__**Fill the given form for your ticket system!**__",
            "",
            "**Hey user's, If you want to create a __ticket system__ just click on below button `Fill Ticket Form` and then fill the details that you want!**",
          ].join("\n"),
        ),
        separatorComponent(),
        {
          type: 1,
          components: [
            ticketButton("raze:ticket:builder:open", "Fill Ticket Form", 1),
          ],
        },
        separatorComponent(),
        textComponent(`${botName()} by ᗯɪɴᴅꜱ™`),
      ],
    },
  ];
}

function configuredTicketPanelComponents(
  draft: TicketPanelDraft,
  guild?: NonNullable<Message["guild"]>,
): RawDiscordComponent[] {
  const ticketTypes = Object.keys(ticketTypeLabels) as TicketType[];
  const heading = replaceNamedEmojiMarkup(draft.heading, guild);
  const buttonComponents = draft.buttons.map((button, index) =>
    ticketButton(
      `raze:ticket:create:${ticketTypes[index]}`,
      button.label,
      button.style,
      button.emoji,
      guild,
    ),
  );
  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        headingComponent(
          `# ${heading}`,
          draft.logoUrl,
        ),
        separatorComponent(),
        textComponent(draft.message),
        separatorComponent(),
        {
          type: 1,
          components: buttonComponents,
        },
        separatorComponent(),
        textComponent(draft.end),
      ],
    },
  ];
}

function ticketPanelDraftKey(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

function ticketBuilderSubmitRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("raze:ticket:builder:save")
      .setLabel("Submit")
      .setStyle(1),
  );
}

function ticketBuilderButtonsRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("raze:ticket:builder:buttons")
      .setLabel("Configure 1-5 Buttons")
      .setStyle(1),
  );
}

function ticketButtonColorRow(index: number) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`raze:ticket:builder:button-color:${index}`)
      .setPlaceholder(`Choose colour for Button ${index + 1}`)
      .addOptions(
        ticketButtonColorOptions.map((option) => ({
          label: option.label,
          value: option.value,
          description: `${option.label} Discord button`,
        })),
      ),
  );
}

function ticketButtonDrafts(rawValue: string) {
  const values = rawValue.split(/\r?\n/).map((line) => line.trim());
  if (values.every((line) => !line)) {
    throw new Error("Add at least one ticket button.");
  }

  return values.map((line, index) => {
    if (!line) {
      return undefined;
    }

    let label = line;
    let emoji: string | undefined;
    const parts = line.split("|").map((part) => part.trim()).filter(Boolean);

    if (parts.length === 2) {
      const [left, right] = parts;
      if (isTicketEmojiInput(left)) {
        emoji = left;
        label = right;
      } else if (isTicketEmojiInput(right)) {
        label = left;
        emoji = right;
      }
    } else {
      const prefixedEmoji = line.match(
        /^(?<emoji><(?:(?:a)?:[^:]+:\d+)>|:[A-Za-z0-9_~-]+:)\s+(?<label>.+)$/,
      );
      if (prefixedEmoji) {
        emoji = prefixedEmoji.groups?.emoji;
        label = prefixedEmoji.groups?.label ?? line;
      } else if (isTicketEmojiInput(line)) {
        emoji = line;
        label = "";
      } else {
        const inlineEmoji = ticketButtonEmojiFromText(line);
        if (inlineEmoji) {
          emoji = inlineEmoji;
          label = line.replace(inlineEmoji, " ");
        }
      }
    }

    label = label.trim().slice(0, 80);
    if (!label && !emoji) {
      throw new Error(`Button ${index + 1} needs a label or emoji.`);
    }
    return {
      label,
      emoji,
    };
  }).filter((button): button is NonNullable<typeof button> => Boolean(button));
}

function ticketBuilderModal() {
  const input = (
    customId: string,
    label: string,
    style: TextInputStyle,
    required: boolean,
    placeholder: string,
  ) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style)
        .setRequired(required)
        .setPlaceholder(placeholder)
        .setMaxLength(style === TextInputStyle.Paragraph ? 4000 : 1000),
    );

  return new ModalBuilder()
    .setCustomId("raze:ticket:builder:form")
    .setTitle(`${botName()} Ticket Builder`)
    .addComponents(
      input(
        "heading",
        "YOUR TICKET HEADING?",
        TextInputStyle.Short,
        true,
        "Example: Need help? Open a ticket",
      ),
      input(
        "message",
        "YOUR TICKET MESSAGE?",
        TextInputStyle.Paragraph,
        true,
        "Explain what users should do in this ticket panel",
      ),
      input(
        "logo",
        "YOUR TICKET LOGO? (URL)",
        TextInputStyle.Short,
        false,
        "https://example.com/logo.png",
      ),
      input(
        "end",
        "YOUR TICKET END?",
        TextInputStyle.Short,
        true,
        `${botName()} by ᗯɪɴᴅꜱ™`,
      ),
    );
}

function ticketButtonConfigModal() {
  const input = (
    number: number,
    placeholder: string,
  ) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(`button-${number}`)
        .setLabel(`BUTTON ${number} (OPTIONAL)`)
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder(placeholder)
        .setMaxLength(1000),
    );

  return new ModalBuilder()
    .setCustomId("raze:ticket:builder:buttons-form")
    .setTitle(`${botName()} Button Setup`)
    .addComponents(
      input(1, "Any emoji or text"),
      input(2, "Any emoji or text"),
      input(3, "Any emoji or text"),
      input(4, "Any emoji or text"),
      input(5, "Any emoji or text"),
    );
}

function ticketStyleName(style: number) {
  return (
    {
      1: "primary",
      2: "secondary",
      3: "success",
      4: "danger",
    } as Record<number, string>
  )[style] ?? "secondary";
}

function ticketCustomizationComponents(guildId: string): RawDiscordComponent[] {
  const panel = ticketPanelConfig(guildId);
  const buttonLines = (Object.keys(ticketTypeLabels) as TicketType[]).map(
    (type) => {
      const button = panel.buttons[type];
      return `${whiteDotEmoji} \`${type}\` — ${button.enabled ? "On" : "Off"} | ${button.label} | ${ticketStyleName(button.style)}${button.emoji ? ` | ${button.emoji}` : ""}`;
    },
  );

  return [
    {
      type: 17,
      accent_color: panel.color,
      components: [
        textComponent(`# 🎨 ${botName()} Ticket Panel Customization`),
        separatorComponent(),
        textComponent(
          [
            `**Heading:** ${panel.heading}`,
            `**Center text:** ${panel.description}`,
            `**Footer:** ${panel.footer}`,
            `**Color:** \`#${panel.color.toString(16).padStart(6, "0")}\``,
          ].join("\n"),
        ),
        separatorComponent(),
        textComponent(["**Buttons:**", ...buttonLines].join("\n")),
        separatorComponent(),
        textComponent(
          [
            `\`${cmdPrefix()}ticket customize heading <text>\``,
            `\`${cmdPrefix()}ticket customize center <text>\``,
            `\`${cmdPrefix()}ticket customize footer <text>\``,
            `\`${cmdPrefix()}ticket customize color <hex>\``,
            `\`${cmdPrefix()}ticket customize button <type> <label>\``,
            `\`${cmdPrefix()}ticket customize emoji <type> <emoji|none>\``,
            `\`${cmdPrefix()}ticket customize style <type> <primary|secondary|success|danger>\``,
            `\`${cmdPrefix()}ticket customize toggle <type> <on|off>\``,
            `\`${cmdPrefix()}ticket customize reset\``,
          ].join("\n"),
        ),
      ],
    },
  ];
}

function ticketChannelComponents(
  type: string,
  ownerId: string,
  status: "open" | "closed" = "open",
  guild?: NonNullable<Message["guild"]>,
): RawDiscordComponent[] {
  const isOpen = status === "open";
  const panel = guild ? ticketPanelConfig(guild.id) : undefined;
  const buttonConfig = panel?.buttons[type as TicketType] ?? panel?.buttons.general;
  const ticketLabel = buttonConfig?.label ?? ticketTypeLabel(type);
  const ticketFooter = panel?.footer ?? `${botName()} Ticket System by ᗯɪɴᴅꜱ™`;
  const supporters = guild
    ? ticketSupporterMentions(guild)
    : "Server administrators and the server owner";
  return [
    {
      type: 17,
      accent_color: isOpen ? panel?.color ?? embedColor : 0xef4444,
      components: [
        headingComponent(
          `${isOpen ? "#" : "# 🔒"} ${ticketLabel}`,
          panel?.logoUrl,
        ),
        separatorComponent(),
        textComponent(
          [
            `**User -** <@${ownerId}>`,
            `**Category -** ${ticketLabel}`,
            `**Supporter -** ${supporters}`,
          ].join("\n"),
        ),
        separatorComponent(),
        {
          type: 1,
          components: isOpen
            ? [
                ticketButton("raze:ticket:claim", "Claim", 1),
                ticketButton("raze:ticket:close", "Close", 2),
              ]
            : [
                ticketButton("raze:ticket:reopen", "Reopen", 1),
                ticketButton("raze:ticket:delete", "Delete", 4),
              ],
        },
        separatorComponent(),
        textComponent(ticketFooter),
      ],
    },
  ];
}

function ticketSupporterMentions(guild: NonNullable<Message["guild"]>) {
  const adminRole = guild.roles.cache
    .filter(
      (role) =>
        role.id !== guild.id &&
        !role.managed &&
        role.permissions.has(PermissionFlagsBits.Administrator),
    )
    .sort((left, right) => right.position - left.position)
    .first();
  const supportRoleId = ticketConfig(guild.id).supportRoleId;
  const supporterMentions = adminRole
    ? [`<@&${adminRole.id}>`]
    : supportRoleId
      ? [`<@&${supportRoleId}>`]
      : ["Server administrators"];
  supporterMentions.push(`<@${guild.ownerId}>`);
  return supporterMentions.join(" and ");
}

async function downloadTicketLogo(logoUrl: string) {
  const response = await fetch(logoUrl);
  if (!response.ok) {
    throw new Error(`The logo URL returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error("The logo URL must point directly to an image file.");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 8 * 1024 * 1024) {
    throw new Error("The logo image must be 8 MB or smaller.");
  }

  const extension =
    {
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }[contentType.split(";")[0].toLowerCase()] ?? "png";

  return {
    attachment: bytes,
    name: `zair-ticket-logo.${extension}`,
  };
}

async function sendTicketCard(
  channel: TextChannel,
  components: RawDiscordComponent[],
) {
  return channel.send({
    flags: MessageFlags.IsComponentsV2,
    components,
  } as never);
}

function servingUserCount(client: Client) {
  return client.guilds.cache.reduce(
    (total, guild) => total + guild.memberCount,
    0,
  );
}

function servingChannelCount(client: Client) {
  return client.guilds.cache.reduce(
    (total, guild) => total + guild.channels.cache.size,
    0,
  );
}

function formatUptime(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function formatDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTimeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("day")}-${value("month")}-${value("year")} | ${Number(value("hour"))}:${value("minute")}`;
}

function botCategoryComponents(
  user: { tag?: string; username: string; id: string },
  page: number,
): RawDiscordComponent[] {
  const pages = [
    [
      `${whiteDotEmoji} \`${cmdPrefix()}stats\` - (It will show the stats of ${botName()})`,
      `${whiteDotEmoji} \`${cmdPrefix()}uptime\` - (Show the current uptime of bot)`,
      `${whiteDotEmoji} \`${cmdPrefix()}ping\` and \`${cmdPrefix()}pong\` - (Show current bot ping)`,
      `${whiteDotEmoji} \`${cmdPrefix()}premium\` - (View ${botName()} premium tiers)`,
    ],
    [
      `${whiteDotEmoji} \`${cmdPrefix()}say\` - (Say something by bot)`,
      `${whiteDotEmoji} \`${cmdPrefix()}embed\` - (View the embed guide)`,
      `${whiteDotEmoji} \`${cmdPrefix()}dm\` - (Dm a particular user by bot)`,
    ],
  ];
  const safePage = Math.max(0, Math.min(page, pages.length - 1));
  const sentAt = Math.floor(Date.now() / 1000);

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent("# BOT COMMAND !!"),
        separatorComponent(),
        textComponent(pages[safePage].join("\n")),
        separatorComponent(),
        paginationButtons("bot-commands", safePage, pages.length),
        separatorComponent(),
        textComponent(
          `Page : ${safePage + 1}/${pages.length} - ${botName()} | ${requesterLabel(user)} • <t:${sentAt}:F>`,
        ),
      ],
    },
  ];
}

function moderationCategoryComponents(
  user: { tag?: string; username: string; id: string },
  page: number,
): RawDiscordComponent[] {
  const pages = [
    [
      `${whiteDotEmoji} \`${cmdPrefix()}automod on/off\` - (Auto moderation for sv)`,
      `${whiteDotEmoji} \`${cmdPrefix()}ban\` - (Ban a sv user)`,
      `${whiteDotEmoji} \`${cmdPrefix()}kick\` - (Kick a sv user)`,
      `${whiteDotEmoji} \`${cmdPrefix()}mute\` - (Muts a sv user)`,
    ],
    [
      `${whiteDotEmoji} \`${cmdPrefix()}unban\` - (unban a user)`,
      `${whiteDotEmoji} \`${cmdPrefix()}unmute\` - (unmute a user)`,
      `${whiteDotEmoji} \`${cmdPrefix()}rape\` - (Rape a sv user)`,
    ],
  ];
  const safePage = Math.max(0, Math.min(page, pages.length - 1));
  const sentAt = Math.floor(Date.now() / 1000);

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent("# MOD COMMAND !!"),
        separatorComponent(),
        textComponent(pages[safePage].join("\n")),
        separatorComponent(),
        paginationButtons("moderation-commands", safePage, pages.length),
        separatorComponent(),
        textComponent(
          `Page : ${safePage + 1}/${pages.length} - ${botName()} | ${requesterLabel(user)} • <t:${sentAt}:F>`,
        ),
      ],
    },
  ];
}

function musicRedirectComponents(user: {
  tag?: string;
  username: string;
  id: string;
}) {
  const sentAt = Math.floor(Date.now() / 1000);
  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(
          `**Hey <@${user.id}> , I'm an all rounder bot but we have launched other bots too...So, add our @Siyaa#3595 for a smooth music experience!**`,
        ),
        textComponent("_Thankyou_"),
        separatorComponent(),
        textComponent(
          `-# - ${botName()} by ᗯɪɴᴅꜱ™ | ${requesterLabel(user)} • <t:${sentAt}:F>`,
        ),
      ],
    },
  ];
}

function makeCategoryResponseComponents(
  user: { tag?: string; username: string; id: string },
  categoryKey: string,
) {
  if (categoryKey === "bot") {
    return botCategoryComponents(user, 0);
  }
  if (categoryKey === "moderation") {
    return moderationCategoryComponents(user, 0);
  }
  if (categoryKey === "music") {
    return musicRedirectComponents(user);
  }

  const categoryDetails = buildCategoryDetails();
  const category = categoryDetails[categoryKey] ?? categoryDetails.bot;
  const sentAt = Math.floor(Date.now() / 1000);
  const title =
    categoryKey === "bot"
      ? "# BOT COMMAND !!"
      : `# ${category.title.replace(" CMD", " COMMAND")} !!`;
  const lines =
    categoryKey === "bot"
      ? [
          `${whiteDotEmoji} \`${cmdPrefix()}stats\` - (It will show the stats of ${botName()})`,
          `${whiteDotEmoji} \`${cmdPrefix()}uptime\` - (Show the current uptime of bot)`,
          `${whiteDotEmoji} \`${cmdPrefix()}ping\` and \`${cmdPrefix()}pong\` - (Show current bot ping)`,
          `${whiteDotEmoji} \`${cmdPrefix()}premium\` - (View ${botName()} premium tiers)`,
        ]
      : category.lines;

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(title),
        separatorComponent(),
        textComponent(lines.join("\n")),
        separatorComponent(),
        textComponent(
          `-# - ${botName()} by ᗯɪɴᴅꜱ™ | ${requesterLabel(user)} • <t:${sentAt}:F>`,
        ),
      ],
    },
  ];
}

function securityCategoryComponents(
  guildId: string | undefined,
  guildName: string,
  page = 0,
) {
  const status = guildId ? securityStatus(guildId) : "Deactive";
  const pages = [
    [
      `${whiteDotEmoji} \`${cmdPrefix()}antinuke enable\` - (Activate protection)`,
      `${whiteDotEmoji} \`${cmdPrefix()}antinuke disable\` - (Deactivate protection)`,
      `${whiteDotEmoji} \`${cmdPrefix()}antinuke status\` - (View full status)`,
      `${whiteDotEmoji} \`${cmdPrefix()}antinuke events\` - (All protected events)`,
    ],
    [
      `${whiteDotEmoji} \`${cmdPrefix()}whitelist add\` - (Add a member to whitelist)`,
      `${whiteDotEmoji} \`${cmdPrefix()}whitelist remove\` - (Remove a member from whitelist)`,
      `${whiteDotEmoji} \`${cmdPrefix()}whitelist show\` - (Show the current whitelist members)`,
      `${whiteDotEmoji} \`${cmdPrefix()}extraowner add/remove/show\` - (Manage extra-owners)`,
    ],
  ];
  const safePage = Math.max(0, Math.min(page, pages.length - 1));

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent("# Z+ Security Command !!"),
        separatorComponent(),
        textComponent(`**Status: __${status}__**`),
        separatorComponent(),
        textComponent(pages[safePage].join("\n")),
        separatorComponent(),
        paginationButtons("security-commands", safePage, pages.length),
        separatorComponent(),
        textComponent(
          `${securityFooter(guildName)} | Page : ${safePage + 1}/${pages.length}`,
        ),
      ],
    },
  ];
}

function statsComponents(client: Client) {
  const stats = [
    `${statsDotEmoji} **Server :** \`${client.guilds.cache.size}\``,
    `${statsDotEmoji} **Users :** \`${servingUserCount(client)}\``,
    `${statsDotEmoji} **Channels :** \`${servingChannelCount(client)}\``,
    `${statsDotEmoji} **Uptime :** \`${formatUptime(client.uptime ?? 0)}\``,
    `${statsDotEmoji} **Ping :** \`${Math.max(0, client.ws.ping)}ms\``,
  ].join("\n");

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(`**${botName()} - Stats**`),
        separatorComponent(),
        textComponent(stats),
        separatorComponent(),
        textComponent(`${botName()} by ᗯɪɴᴅꜱ™`),
      ],
    },
  ];
}

function makeHelpComponents(
  user: { tag?: string; username: string; id: string },
  guildName: string,
  guildPrefix = cmdPrefix(),
  selectedCategory?: string,
  servedUsers = 0,
  categoryPage = 0,
) {
  const sentAt = Math.floor(Date.now() / 1000);
  const categoryDetails = buildCategoryDetails();
  const category = selectedCategory
    ? categoryDetails[selectedCategory] ?? categoryDetails.bot
    : undefined;
  const content: RawDiscordComponent[] = [
    textComponent(`# ${botName()} - Help Centre !!`),
    separatorComponent(),
    textComponent(
      [
        `${redDotEmoji} **${botName()} TYPE -** \`OMNIBUS\``,
        `${redDotEmoji} **${botName()} SERVING -** \`${servedUsers.toLocaleString()} users\``,
        `${redDotEmoji} **${botName()} PREFIX -** \`${guildPrefix}\``,
      ].join("\n"),
    ),
    separatorComponent(),
  ];

  if (category) {
    content.push(
      textComponent(
        `**${category.title} -**\n${category.lines.join("\n")}`,
      ),
      separatorComponent(),
      ...categorySelects(categoryPage),
      separatorComponent(),
    );
  } else {
    content.push(
      textComponent(
        `${houseEmoji} **MAIN FEATURES -**`,
      ),
      ...categorySelects(categoryPage),
      separatorComponent(),
      helpPageButtons(categoryPage),
      separatorComponent(),
    );
  }

  content.push(
    textComponent(
      `-# - ${botName()} by ᗯɪɴᴅꜱ™ | ${requesterLabel(user)} • <t:${sentAt}:F>`,
    ),
  );

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: content,
    },
    supportButtonComponent(),
  ];
}

async function removeOldCommands(applicationId: string, guildIds: string[]) {
  if (!token) {
    throw new Error(`DISCORD_BOT_TOKEN is required to start ${botName()}.`);
  }

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(applicationId), {
    body: [helpCommand()],
  });

  await Promise.all(
    guildIds.map(async (guildId) => {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
        body: [],
      });
    }),
  );

  logger.info(
    { guildCount: guildIds.length },
    `${botName()} command registry reset; /help is active`,
  );
}

function applyBotPresence(client: Client<true>) {
  client.user.setPresence({
    status: "dnd",
    activities: [
      {
        name: `${cmdPrefix()}help • 2k+`,
        type: ActivityType.Watching,
      },
    ],
  });
}

function helpPayload(
  user: { tag?: string; username: string; id: string },
  guildName: string,
  servedUsers: number,
) {
  return {
    flags: 32768,
    components: makeHelpComponents(
      user,
      guildName,
      cmdPrefix(),
      undefined,
      servedUsers,
    ),
  };
}

function respondToSlashHelp(interaction: ChatInputCommandInteraction) {
  return interaction.reply(
    helpPayload(
      interaction.user,
      interaction.guild?.name ?? "Direct Message",
      servingUserCount(interaction.client),
    ) as never,
  );
}

function respondToPrefixHelp(message: Message) {
  if (!message.channel.isSendable()) {
    return;
  }

  return message.channel.send(
    helpPayload(
      message.author,
      message.guild?.name ?? "Direct Message",
      servingUserCount(message.client),
    ) as never,
  );
}

function respondToPrefixStats(message: Message) {
  if (!message.channel.isSendable()) {
    return;
  }

  return message.channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: statsComponents(message.client),
  } as never);
}

function respondToPrefixPing(message: Message) {
  if (!message.channel.isSendable()) {
    return;
  }

  return message.channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        accent_color: embedColor,
        components: [
          textComponent(`**${botName()} - Ping**`),
          separatorComponent(),
          textComponent(
            `${statsDotEmoji} **Current Ping :** \`${Math.max(0, message.client.ws.ping)}ms\``,
          ),
        ],
      },
    ],
  } as never);
}

function premiumComponents(): RawDiscordComponent[] {
  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(`# ${botName()} - PREMIUM ${kingPepeEmoji}`),
        separatorComponent(),
        textComponent(
          [
            `${winterStarEmoji} | **${botName()} - __Premiun Tier  1__** ${pixelDiamondEmoji} \`[ User-Prime ]\``,
            "",
            "__**Perks:**__",
            "",
            `${whiteArrowEmoji} No-Prefix for a month`,
            `${whiteArrowEmoji} Prior support by winds team & owner`,
            "",
            `${utilityArrowEmoji} **Price ₹39 or 0.4$ ltc per month!**`,
          ].join("\n"),
        ),
        separatorComponent(),
        textComponent(
          [
            `${winterStarEmoji} **| ${botName()} - __Premiun Tier  2 ${diamondEmoji}__** \`[ Guild-Prime ]\``,
            "",
            "**__Perks:__**",
            "",
            `${redArrowEmoji} Custom bot profile for your guild (custom name, avatar, banner & bio)`,
            `${redArrowEmoji} No-Prefix Access to any 2 member of your guild by bot owner <@${botOwnerUserId}>`,
            `${redArrowEmoji} Bot setup & Prior support by winds team.`,
            "",
            `${utilityArrowEmoji} **Price ₹99 or 1$ ltc per month!**`,
          ].join("\n"),
        ),
        separatorComponent(),
        textComponent(
          [
            `${winterStarEmoji} | **${botName()} - __Premiun Tier  3__** ${redDiamondEmoji} \`[ Max-Prime ]\``,
            "",
            "**__Perks:__**",
            "",
            `${blackArrowEmoji} Every single thing of tier 1 & 2 included`,
            `${blackArrowEmoji} Prior support by winds owner`,
            `${blackArrowEmoji} Can add one cmd in bot without any req instant`,
            "",
            `${utilityArrowEmoji} **Price ₹499 or 5$ ltc per month!**`,
          ].join("\n"),
        ),
        separatorComponent(),
        textComponent(`${botName()} Premium by ᗯɪɴᴅꜱ™`),
      ],
    },
  ];
}

function premiumBuyButtonComponent(): RawDiscordComponent {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 5,
        label: "Ⓟ | click here to buy",
        url: "https://discord.com/channels/1460938919259672702/1486763021958254824",
      },
    ],
  };
}

function premiumActivationComponents(
  tierName: string,
  durationLabel: string,
  expiresAt: Date,
): RawDiscordComponent[] {
  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(`${kingPepeEmoji}**Your Subscription Activated!**`),
        separatorComponent(),
        textComponent(
          [
            "__Your prime subscription is now active__",
            `**Tier :** \`${tierName}\``,
            `**Limit :** \`${durationLabel}\``,
            `**Ends :** \`${formatPremiumEndDate(expiresAt)}\``,
          ].join("\n"),
        ),
        separatorComponent(),
      ],
    },
  ];
}

function premiumTierComponents(
  tierNumber: PremiumGrant["tierNumber"],
): RawDiscordComponent[] {
  const tierText = {
    1: [
      `${winterStarEmoji} | **${botName()} - __Premiun Tier  1__** ${pixelDiamondEmoji} \`[ User-Prime ]\``,
      "",
      "__**Perks:**__",
      "",
      `${whiteArrowEmoji} No-Prefix for a month`,
      `${whiteArrowEmoji} Prior support by winds team owner.`,
    ].join("\n"),
    2: [
      `${winterStarEmoji} | **${botName()} - __Premiun Tier  2__** ${diamondEmoji} \`[ Guild-Prime ]\``,
      "",
      "**__Perks:__**",
      "",
      `${redArrowEmoji} Custom bot profile for your guild (custom name, avatar, banner & bio)`,
      `${redArrowEmoji} No-Prefix Access to any 2 member of your guild by bot owner <@${botOwnerUserId}>`,
      `${redArrowEmoji} Bot setup & Prior support by winds team.`,
    ].join("\n"),
    3: [
      `${winterStarEmoji} | **${botName()} - __Premiun Tier  3__** ${redDiamondEmoji} \`[ Max-Prime ]\``,
      "",
      "**__Perks:__**",
      "",
      `${blackArrowEmoji} Every single thing of tier 1 & 2 included`,
      `${blackArrowEmoji} Prior support by winds owner`,
      `${blackArrowEmoji} Can add one cmd in bot without any req instant`,
    ].join("\n"),
  }[tierNumber];

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(`# ${botName()} - PREMIUM ${kingPepeEmoji}`),
        separatorComponent(),
        textComponent(tierText),
        separatorComponent(),
        textComponent(`${botName()} Premium by ᗯɪɴᴅꜱ™`),
      ],
    },
  ];
}

function premiumRemovedComponents(): RawDiscordComponent[] {
  return [
    {
      type: 17,
      accent_color: 0xef4444,
      components: [
        textComponent(`**${botName()} - Premium Removed!**`),
        separatorComponent(),
        textComponent(
          [
            "__Your premium is removed!__",
            "",
            "Note : If you feel its mistake so dm bot owner `sadiq_ahmed321`",
          ].join("\n"),
        ),
        separatorComponent(),
        textComponent(`${botName()} by ᗯɪɴᴅꜱ™`),
      ],
    },
  ];
}

function premiumExpiredComponents(): RawDiscordComponent[] {
  return [
    {
      type: 17,
      accent_color: 0xef4444,
      components: [
        textComponent(`**${botName()} - Premium Expired!**`),
        separatorComponent(),
        textComponent(
          [
            "__Your premium subscription has ended.__",
            "Your premium perks are no longer active.",
          ].join("\n"),
        ),
        separatorComponent(),
        textComponent(`${botName()} by ᗯɪɴᴅꜱ™`),
      ],
    },
  ];
}

function formatPremiumEndDate(date: Date) {
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: displayTimeZone,
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: displayTimeZone,
  }).format(date);
  return `${datePart} | ${timePart}`;
}

function premiumDuration(durationLabel: string) {
  const match = durationLabel.trim().toLowerCase().match(
    /^(?<amount>\d+)(?<unit>min|m|h|d|w|mo)$/,
  );
  if (!match?.groups) {
    return undefined;
  }

  const amount = Number(match.groups.amount);
  const unit = match.groups.unit;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return undefined;
  }

  const unitMs: Record<string, number> = {
    min: 60 * 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    mo: 30 * 24 * 60 * 60 * 1000,
  };
  return unitMs[unit] ? amount * unitMs[unit] : undefined;
}

async function expirePremium(userId: string, client: Client) {
  const grant = premiumGrants.get(userId);
  if (!grant) {
    premiumExpiryTimers.delete(userId);
    return;
  }

  if (grant.expiresAt.getTime() > Date.now()) {
    schedulePremiumExpiry(userId, grant, client);
    return;
  }

  premiumGrants.delete(userId);
  noPrefixGrants.delete(userId);
  premiumExpiryTimers.delete(userId);

  try {
    const user = await client.users.fetch(userId);
    await user.send({
      flags: MessageFlags.IsComponentsV2,
      components: premiumExpiredComponents(),
    } as never);
    logger.info({ userId }, `${botName()} sent premium expiry DM`);
  } catch (error) {
    logger.warn({ err: error, userId }, `${botName()} could not send premium expiry DM`);
  }
}

function schedulePremiumExpiry(
  userId: string,
  grant: PremiumGrant,
  client: Client,
) {
  const previousTimer = premiumExpiryTimers.get(userId);
  if (previousTimer) {
    clearTimeout(previousTimer);
  }

  const remainingMs = Math.max(0, grant.expiresAt.getTime() - Date.now());
  const maxTimerMs = 2_147_000_000;
  const timer = setTimeout(
    () => void expirePremium(userId, client),
    Math.min(remainingMs, maxTimerMs),
  );
  premiumExpiryTimers.set(userId, timer);
}

function hasNoPrefixAccess(userId: string) {
  if (userId === botOwnerUserId) {
    return true;
  }

  const expiresAt = noPrefixGrants.get(userId);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt.getTime() <= Date.now()) {
    noPrefixGrants.delete(userId);
    return false;
  }

  return true;
}

function updateNoPrefixForPremium(userId: string, grant: PremiumGrant) {
  if (grant.tierNumber === 1 || grant.tierNumber === 3) {
    noPrefixGrants.set(userId, grant.expiresAt);
  } else {
    noPrefixGrants.delete(userId);
  }
}

async function respondToPremiumActivate(message: Message, args: string[]) {
  if (message.author.id !== botOwnerUserId) {
    return;
  }

  const userId = userIdFromArgument(args[0]);
  const tierNumber = Number(args[1]);
  const legacyTierName = args[3] ? args[2]?.trim() : undefined;
  const tierName = legacyTierName ?? String(tierNumber);
  const durationLabel = (args[3] ?? args[2])?.trim();
  const durationMs = durationLabel ? premiumDuration(durationLabel) : undefined;

  if (
    !userId ||
    ![1, 2, 3].includes(tierNumber) ||
    !durationLabel ||
    !durationMs
  ) {
    await message.reply(
      `Usage: \`${cmdPrefix()}ap @user <1|2|3> <duration>\` — example: \`${cmdPrefix()}ap @user 3 1000d\``,
    );
    return;
  }

  try {
    const user = await message.client.users.fetch(userId);
    const expiresAt = new Date(Date.now() + durationMs);
    const grant: PremiumGrant = {
      tierNumber: tierNumber as PremiumGrant["tierNumber"],
      tierName,
      durationLabel,
      expiresAt,
    };
    premiumGrants.set(userId, grant);
    updateNoPrefixForPremium(userId, grant);
    schedulePremiumExpiry(userId, grant, message.client);

    await user.send({
      flags: MessageFlags.IsComponentsV2,
      components: premiumActivationComponents(
        grant.tierName,
        grant.durationLabel,
        grant.expiresAt,
      ),
    } as never);
    await user.send({
      flags: MessageFlags.IsComponentsV2,
      components: premiumTierComponents(grant.tierNumber),
    } as never);
    await message.reply(
      `Premium activated for <@${userId}> — Tier ${grant.tierNumber}, ${grant.durationLabel}.`,
    );
  } catch (error) {
    logger.warn({ err: error, userId }, `${botName()} premium activation failed`);
    await message.reply(
      "I could not DM that user. Check that the user ID or mention is correct and that their DMs are open.",
    );
  }
}

async function respondToPremiumRemove(message: Message, args: string[]) {
  if (message.author.id !== botOwnerUserId) {
    return;
  }

  const userId = userIdFromArgument(args[0]);
  if (!userId) {
    await message.reply(`Usage: \`${cmdPrefix()}rp @user\``);
    return;
  }

  try {
    const user = await message.client.users.fetch(userId);
    premiumGrants.delete(userId);
    noPrefixGrants.delete(userId);
    const expiryTimer = premiumExpiryTimers.get(userId);
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      premiumExpiryTimers.delete(userId);
    }
    await user.send({
      flags: MessageFlags.IsComponentsV2,
      components: premiumRemovedComponents(),
    } as never);
    await message.reply(`Premium removed for <@${userId}>.`);
  } catch (error) {
    logger.warn({ err: error, userId }, `${botName()} premium removal failed`);
    await message.reply(
      "I could not DM that user. Check that the user ID or mention is correct and that their DMs are open.",
    );
  }
}

async function respondToNoPrefixCommand(message: Message, args: string[]) {
  if (message.author.id !== botOwnerUserId) {
    return;
  }

  const action = args[0]?.toLowerCase();
  const userId = userIdFromArgument(args[1]);
  if (!userId || (action !== "add" && action !== "remove")) {
    await message.reply(`Usage: \`${cmdPrefix()}np add @user 30d\` or \`${cmdPrefix()}np remove @user\``);
    return;
  }

  if (action === "remove") {
    noPrefixGrants.delete(userId);
    await message.reply(`No-prefix removed for <@${userId}>.`);
    return;
  }

  const durationLabel = args[2]?.trim();
  const durationMs = durationLabel ? premiumDuration(durationLabel) : undefined;
  if (!durationLabel || !durationMs) {
    await message.reply(`Usage: \`${cmdPrefix()}np add @user 30d\``);
    return;
  }

  noPrefixGrants.set(userId, new Date(Date.now() + durationMs));
  await message.reply(
    `No-prefix added for <@${userId}> for ${durationLabel}.`,
  );
}

function respondToPrefixPremium(message: Message) {
  if (!message.channel.isSendable()) {
    return;
  }

  return message.channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [...premiumComponents(), premiumBuyButtonComponent()],
  } as never);
}

function respondToPrefixUptime(message: Message) {
  if (!message.channel.isSendable()) {
    return;
  }

  return message.channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        accent_color: embedColor,
        components: [
          textComponent(`**${botName()} - Uptime**`),
          separatorComponent(),
          textComponent(
            [
              `${statsDotEmoji} **Local Time :**`,
              `\`${formatDateTime(new Date())}\``,
              `${statsDotEmoji} **Current Uptime :**`,
              `\`${formatUptime(message.client.uptime ?? 0)}\``,
              `${statsDotEmoji} **Start Time :**`,
              `\`${formatDateTime(message.client.readyAt ?? new Date(Date.now() - (message.client.uptime ?? 0)))}\``,
            ].join("\n"),
          ),
        ],
      },
    ],
  } as never);
}

function respondToSecurityCard(
  message: Message,
  title: string,
  lines: string[],
) {
  if (!message.channel.isSendable()) {
    return;
  }

  return message.channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        accent_color: embedColor,
        components: [
          textComponent(title),
          separatorComponent(),
          textComponent(lines.join("\n")),
        ],
      },
    ],
  } as never);
}

function paginationButton(
  customId: string,
  emoji: { id: string; name: string },
  disabled = false,
): RawDiscordComponent {
  return {
    type: 2,
    style: 2,
    custom_id: customId,
    emoji,
    disabled,
  };
}

function paginationButtons(
  scope: string,
  page: number,
  totalPages: number,
  emojis = {
    previous: protectedEventsPreviousEmoji,
    trash: protectedEventsTrashEmoji,
    next: protectedEventsNextEmoji,
  },
): RawDiscordComponent {
  return {
    type: 1,
    components: [
      paginationButton(
        `raze:${scope}:previous:${page}`,
        emojis.previous,
        page === 0,
      ),
      paginationButton(
        `raze:${scope}:trash:${page}`,
        emojis.trash,
      ),
      paginationButton(
        `raze:${scope}:next:${page}`,
        emojis.next,
        page === totalPages - 1,
      ),
    ],
  };
}

function protectedEventsComponents(page: number): RawDiscordComponent[] {
  const totalPages = Math.ceil(
    protectedSecurityEvents.length / protectedEventsPerPage,
  );
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const firstEvent = safePage * protectedEventsPerPage;
  const events = protectedSecurityEvents.slice(
    firstEvent,
    firstEvent + protectedEventsPerPage,
  );

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(
          `**${botName()} - Protected Events** ${greenRoleIconEmoji}`,
        ),
        separatorComponent(),
        textComponent(events.join("\n")),
        separatorComponent(),
        paginationButtons("protected-events", safePage, totalPages),
        separatorComponent(),
        textComponent(
          `Page : ${safePage + 1}/${totalPages} - ${botName()}`,
        ),
      ],
    },
  ];
}

async function usernameFromClient(client: Client, userId: string) {
  try {
    const user = await client.users.fetch(userId);
    return user.username;
  } catch {
    return userId;
  }
}

async function whitelistUserName(message: Message, userId: string) {
  const mentionedUser = message.mentions.users.get(userId);
  if (mentionedUser) {
    return mentionedUser.username;
  }

  return usernameFromClient(message.client, userId);
}

async function whitelistShowComponents(
  client: Client,
  guildId: string,
  page: number,
): Promise<RawDiscordComponent[]> {
  const memberIds = [...guildSecurityState(guildId).whitelist];
  const totalPages = Math.max(
    1,
    Math.ceil(memberIds.length / whitelistedMembersPerPage),
  );
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const firstMember = safePage * whitelistedMembersPerPage;
  const pageMemberIds = memberIds.slice(
    firstMember,
    firstMember + whitelistedMembersPerPage,
  );
  const members = await Promise.all(
    pageMemberIds.map(async (userId) => {
      const username = await usernameFromClient(client, userId);
      return `${username} - ID - @${userId}`;
    }),
  );

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(
          `**${botName()} - Whitelisted Show** ${catNotedEmoji}`,
        ),
        separatorComponent(),
        textComponent(
          members.length > 0 ? members.join("\n") : "No whitelisted members.",
        ),
        separatorComponent(),
        paginationButtons("whitelist-show", safePage, totalPages),
        separatorComponent(),
        textComponent(
          `Page : ${safePage + 1}/${totalPages} - ${botName()}`,
        ),
      ],
    },
  ];
}

async function extraOwnerShowComponents(
  client: Client,
  guildId: string,
): Promise<RawDiscordComponent[]> {
  const memberIds = [...guildSecurityState(guildId).extraOwners];
  const members = await Promise.all(
    memberIds.map(async (userId) => {
      const username = await usernameFromClient(client, userId);
      return `${username} - ID - @${userId}`;
    }),
  );

  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(
          `**${botName()} - Extra-Owner Registry** ${greenRoleIconEmoji}`,
        ),
        separatorComponent(),
        textComponent(
          members.length > 0 ? members.join("\n") : "No extra-owners added.",
        ),
        separatorComponent(),
        textComponent(
          `${members.length}/${extraOwnerMaxSlots} slots used`,
        ),
      ],
    },
  ];
}

function autoModSetupComponents(): RawDiscordComponent[] {
  return [
    {
      type: 17,
      accent_color: embedColor,
      components: [
        textComponent(`**${botName()} - AutoMod** ${"<:KarmaLion:1550897602793439263>"}`),
        separatorComponent(),
        textComponent(
          `${winterStarEmoji} **${botName()} AutoMod : __Now the ${botName()} bot will auto moderate your server with high-end mod system.__**`,
        ),
        separatorComponent(),
        textComponent(`${botName()} by ᗯɪɴᴅꜱ™`),
      ],
    },
  ];
}

function autoModBypass(message: Message) {
  return Boolean(
    message.guild &&
      (message.guild.ownerId === message.author.id ||
        message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
        message.member?.permissions.has(PermissionFlagsBits.ManageMessages)),
  );
}

function autoModViolation(message: Message) {
  const content = message.content.toLowerCase();
  const abusiveWord = autoModBannedWords.find((word) =>
    new RegExp(`\\b${word}\\b`, "i").test(content),
  );

  if (abusiveWord) {
    return {
      reason: `Abusive language detected: ${abusiveWord}`,
      accentColor: 0xf97316,
    };
  }

  if (autoModLinkPattern.test(message.content) && !autoModBypass(message)) {
    return {
      reason: "Unauthorized link posted without moderation permission",
      accentColor: 0xfacc15,
    };
  }

  return null;
}

function findAutoModChannel(message: Message): TextChannel | undefined {
  return message.guild?.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText &&
      channel.name === autoModChannelName,
  );
}

function autoModEnabled(message: Message) {
  return Boolean(
    message.guild &&
      !autoModDisabledGuilds.has(message.guild.id) &&
      findAutoModChannel(message),
  );
}

async function sendAutoModIncident(
  message: Message,
  reason: string,
  punishment: string,
  accentColor: number,
) {
  const channel = findAutoModChannel(message);
  if (!channel?.isSendable()) {
    return;
  }

  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components: [
          textComponent(`**${botName()} - AutoMod**`),
          separatorComponent(),
          textComponent(
            [
              "**User :**",
              `\`${message.author.username} (${message.author.id})\``,
              "**Reason :**",
              `\`${reason}\``,
              "**Punishment :**",
              `\`${punishment}\``,
            ].join("\n"),
          ),
        ],
      },
    ],
  } as never);
}

async function moderateMessage(message: Message) {
  if (
    !message.guild ||
    !message.member ||
    !autoModEnabled(message) ||
    autoModBypass(message)
  ) {
    return false;
  }

  const violation = autoModViolation(message);
  if (!violation) {
    return false;
  }

  try {
    await message.delete();
  } catch (error) {
    logger.warn({ err: error }, `${botName()} AutoMod could not delete a message`);
  }

  let punishment = "Message deleted";
  if (message.member.moderatable) {
    try {
      await message.member.timeout(
        autoModTimeoutMs,
        `${botName()} AutoMod: ${violation.reason}`,
      );
      punishment = "Message deleted + 10-minute timeout";
    } catch (error) {
      logger.warn({ err: error }, `${botName()} AutoMod could not apply timeout`);
      punishment = "Message deleted; timeout unavailable";
    }
  } else {
    punishment = "Message deleted; timeout unavailable";
  }

  try {
    await sendAutoModIncident(
      message,
      violation.reason,
      punishment,
      violation.accentColor,
    );
  } catch (error) {
    logger.warn({ err: error }, `${botName()} AutoMod could not send incident card`);
  }

  return true;
}

async function respondToAutoModCommand(message: Message, args: string[]) {
  if (!message.guild) {
    await message.reply("AutoMod can only be used inside a server.");
    return;
  }

  if (!isServerAdministratorOrOwner(message)) {
    await message.reply(
      `Only the server owner or an administrator can control ${botName()} AutoMod.`,
    );
    return;
  }

  const action = args[0]?.toLowerCase() ?? "on";
  if (action !== "on" && action !== "off") {
    await message.reply(`Usage: \`${cmdPrefix()}automod on\` or \`${cmdPrefix()}automod off\``);
    return;
  }

  if (action === "off") {
    autoModDisabledGuilds.add(message.guild.id);
    await moderationCard(message, `**${botName()} - AutoMod**`, [
      `${redDotEmoji} **Status :** \`Disabled\``,
      "Auto moderation is paused. The private log channel was kept.",
    ], 0xfacc15);
    return;
  }

  const botUserId = message.client.user?.id;
  if (!botUserId) {
    await message.reply(`${botName()} is still connecting. Please try again in a moment.`);
    return;
  }

  let channel: TextChannel | undefined = findAutoModChannel(message);
  if (!channel) {
    channel = await message.guild.channels.create({
      name: autoModChannelName,
      type: ChannelType.GuildText,
      position: 0,
      permissionOverwrites: [
        {
          id: message.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: botUserId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });
  }

  await channel.setPosition(0);
  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: autoModSetupComponents(),
  } as never);
  autoModDisabledGuilds.delete(message.guild.id);
  await message.reply(
    `${botName()} AutoMod is active. Private log channel: <#${channel.id}>`,
  );
}

function moderationCard(
  message: Message,
  title: string,
  lines: string[],
  accentColor = embedColor,
) {
  if (!message.channel.isSendable()) {
    return;
  }

  return message.channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components: [
          textComponent(title),
          separatorComponent(),
          textComponent(lines.join("\n")),
          separatorComponent(),
          textComponent(`${botName()} by ᗯɪɴᴅꜱ™`),
        ],
      },
    ],
  } as never);
}

function parseMuteDuration(argument?: string) {
  const match = argument?.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  } as const;
  const milliseconds = amount * multipliers[unit as keyof typeof multipliers];
  const maximumTimeoutMs = 28 * 86_400_000;

  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1_000) {
    return undefined;
  }

  if (milliseconds > maximumTimeoutMs) {
    return undefined;
  }

  return {
    milliseconds,
    label: `${amount}${unit}`,
  };
}

function canUseModerationCommand(message: Message, permission: bigint) {
  return Boolean(
    message.guild &&
      message.member &&
      (message.guild.ownerId === message.author.id ||
        message.member.permissions.has(PermissionFlagsBits.Administrator) ||
        message.member.permissions.has(permission)),
  );
}

function moderationTargetIssue(message: Message, targetId: string) {
  if (targetId === message.author.id) {
    return "You cannot moderate yourself.";
  }

  if (targetId === message.guild?.ownerId) {
    return "The server owner cannot be moderated.";
  }

  if (targetId === message.client.user?.id) {
    return `${botName()} cannot moderate itself.`;
  }

  return undefined;
}

async function respondToModerationCommand(
  message: Message,
  command: "ban" | "kick" | "mute",
  args: string[],
) {
  if (!message.guild || !message.member) {
    await message.reply("Moderation commands can only be used inside a server.");
    return;
  }

  const requiredPermission = {
    ban: PermissionFlagsBits.BanMembers,
    kick: PermissionFlagsBits.KickMembers,
    mute: PermissionFlagsBits.ModerateMembers,
  }[command];

  if (!canUseModerationCommand(message, requiredPermission)) {
    await message.reply(
      `You need the ${command === "mute" ? "Moderate Members" : command === "ban" ? "Ban Members" : "Kick Members"} permission to use !${command}.`,
    );
    return;
  }

  const targetId = userIdFromArgument(args[0]);
  if (!targetId) {
    await moderationCard(
      message,
      `**${botName()} - ${command.toUpperCase()}**`,
      [
        `${redDotEmoji} **Usage :** \`${cmdPrefix()}${command} @user [reason]\``,
        command === "mute"
          ? `${whiteDotEmoji} Optional mute duration: \`10m\`, \`1h\`, or \`1d\``
          : `${whiteDotEmoji} Mention a server member or provide their user ID.`,
      ],
      0xef4444,
    );
    return;
  }

  const targetIssue = moderationTargetIssue(message, targetId);
  if (targetIssue) {
    await message.reply(targetIssue);
    return;
  }

  const target = await message.guild.members.fetch(targetId).catch(() => undefined);
  if (!target) {
    await message.reply(`${botName()} could not find that member in this server.`);
    return;
  }

  if (
    message.guild.ownerId !== message.author.id &&
    message.member.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    await message.reply("Your highest role must be above the target's highest role.");
    return;
  }

  let reasonArgs = args.slice(1);
  let muteDuration = {
    milliseconds: autoModTimeoutMs,
    label: "10m",
  };
  if (command === "mute") {
    const parsedDuration = parseMuteDuration(args[1]);
    if (parsedDuration) {
      muteDuration = parsedDuration;
      reasonArgs = args.slice(2);
    }
  }
  const reason = reasonArgs.join(" ").trim() || "No reason provided";

  try {
    if (command === "ban") {
      if (!target.bannable) {
        await message.reply(`${botName()} cannot ban that member because of role hierarchy.`);
        return;
      }
      await target.ban({ reason });
    } else if (command === "kick") {
      if (!target.kickable) {
        await message.reply(`${botName()} cannot kick that member because of role hierarchy.`);
        return;
      }
      await target.kick(reason);
    } else {
      if (!target.moderatable) {
        await message.reply(`${botName()} cannot mute that member because of role hierarchy.`);
        return;
      }
      await target.timeout(muteDuration.milliseconds, reason);
    }
  } catch (error) {
    logger.warn({ err: error, command, targetId }, `${botName()} moderation action failed`);
    await message.reply(`${botName()} could not ${command} that member. Check my server permissions.`);
    return;
  }

  const punishment =
    command === "mute"
      ? `Muted for ${muteDuration.label}`
      : command === "ban"
        ? "Banned from the server"
        : "Kicked from the server";
  await moderationCard(message, `**${botName()} - ${command.toUpperCase()}**`, [
    `${greenRoleIconEmoji} **User :** <@${target.id}>`,
    `${whiteDotEmoji} **Punishment :** \`${punishment}\``,
    `${whiteDotEmoji} **Reason :** \`${reason}\``,
  ]);
}

async function respondToUnbanCommand(message: Message, args: string[]) {
  if (!message.guild || !message.member) {
    await message.reply("Moderation commands can only be used inside a server.");
    return;
  }

  if (!canUseModerationCommand(message, PermissionFlagsBits.BanMembers)) {
    await message.reply(`You need the Ban Members permission to use ${cmdPrefix()}unban.`);
    return;
  }

  const targetId = userIdFromArgument(args[0]);
  if (!targetId) {
    await message.reply(`Usage: \`${cmdPrefix()}unban <user ID>\``);
    return;
  }

  const bannedUser = await message.guild.bans.fetch(targetId).catch(() => undefined);
  if (!bannedUser) {
    await message.reply("That user is not currently banned from this server.");
    return;
  }

  const reason = args.slice(1).join(" ").trim() || "No reason provided";
  try {
    await message.guild.bans.remove(targetId, reason);
  } catch (error) {
    logger.warn({ err: error, targetId }, `${botName()} unban action failed`);
    await message.reply(`${botName()} could not unban that user. Check my server permissions.`);
    return;
  }

  await moderationCard(message, `**${botName()} - UNBAN**`, [
    `${greenRoleIconEmoji} **User :** \`${bannedUser.user.username} (${targetId})\``,
    `${whiteDotEmoji} **Punishment :** \`Ban removed\``,
    `${whiteDotEmoji} **Reason :** \`${reason}\``,
  ]);
}

async function respondToUnmuteCommand(message: Message, args: string[]) {
  if (!message.guild || !message.member) {
    await message.reply("Moderation commands can only be used inside a server.");
    return;
  }

  if (!canUseModerationCommand(message, PermissionFlagsBits.ModerateMembers)) {
    await message.reply(`You need the Moderate Members permission to use ${cmdPrefix()}unmute.`);
    return;
  }

  const targetId = userIdFromArgument(args[0]);
  if (!targetId) {
    await message.reply(`Usage: \`${cmdPrefix()}unmute @user [reason]\``);
    return;
  }

  const targetIssue = moderationTargetIssue(message, targetId);
  if (targetIssue) {
    await message.reply(targetIssue);
    return;
  }

  const target = await message.guild.members.fetch(targetId).catch(() => undefined);
  if (!target) {
    await message.reply(`${botName()} could not find that member in this server.`);
    return;
  }

  if (
    message.guild.ownerId !== message.author.id &&
    message.member.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    await message.reply("Your highest role must be above the target's highest role.");
    return;
  }

  const reason = args.slice(1).join(" ").trim() || "No reason provided";
  try {
    await target.timeout(null, reason);
  } catch (error) {
    logger.warn({ err: error, targetId }, `${botName()} unmute action failed`);
    await message.reply(`${botName()} could not unmute that member. Check my server permissions.`);
    return;
  }

  await moderationCard(message, `**${botName()} - UNMUTE**`, [
    `${greenRoleIconEmoji} **User :** <@${target.id}>`,
    `${whiteDotEmoji} **Punishment :** \`Timeout removed\``,
    `${whiteDotEmoji} **Reason :** \`${reason}\``,
  ]);
}

async function respondToUnsafeRapeCommand(message: Message) {
  await moderationCard(
    message,
    `**${botName()} - Moderation**`,
    [
      `${redDotEmoji} **This command is disabled.**`,
      `${botName()} does not perform or simulate sexual violence against server members.`,
      `${whiteDotEmoji} Use \`${cmdPrefix()}mute\`, \`${cmdPrefix()}kick\`, or \`${cmdPrefix()}ban\` for server moderation.`,
    ],
    0xef4444,
  );
}

async function respondToBotUtilityCommand(
  message: Message,
  command: "say" | "embed" | "dm",
  args: string[],
) {
  if (!message.guild) {
    await message.reply("Bot utility commands can only be used inside a server.");
    return;
  }

  if (command !== "embed" && !isServerAdministratorOrOwner(message)) {
    await message.reply(
      "Only the server owner or an administrator can use bot utility commands.",
    );
    return;
  }

  if (command === "dm") {
    const targetId = userIdFromArgument(args[0]);
    const content = args.slice(1).join(" ").trim();
    if (!targetId || !content) {
      await message.reply(`Usage: \`${cmdPrefix()}dm @user <message>\``);
      return;
    }

    try {
      const user = await message.client.users.fetch(targetId);
      await user.send(content);
      await message.reply(`${botName()} sent a DM to <@${targetId}>.`);
    } catch (error) {
      logger.warn({ err: error, targetId }, `${botName()} could not send a DM`);
      await message.reply(
        `${botName()} could not send that DM. The user may have DMs disabled.`,
      );
    }
    return;
  }

  if (command === "embed" && args.length === 0) {
    if (!message.channel.isSendable()) {
      return;
    }

    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: 17,
          accent_color: embedColor,
          components: [
            textComponent(`# ${botName()} - Embed Guide <:Blush:1551166605143052303>`),
            separatorComponent(),
            textComponent("**Hey user,** <:FlorkAngel:1548770287959675040>"),
            separatorComponent(),
            textComponent(
              `**_Its an guide to send a embed message using ${botName()} !!_**`,
            ),
            separatorComponent(),
            textComponent("__**Follow the given steps:**__"),
            separatorComponent(),
            textComponent(
              [
                `1. Use cmd \`${cmdPrefix()}embed send\``,
                `2. Write your heading normally, eg. \`${botName()} - heading\` (it will always be big)`,
                "3. Use `**message**` when you want bold text",
                "4. Attach a photo to show it beside the heading",
                "5. Use `,` for a native embed line",
                "6. Write the message you want, eg. `Hey, I am dev`",
                "7. Use another `,` for the next native embed line",
                "8. End with your own final message, eg. `ᗯɪɴᴅꜱ™`",
              ].join("\n"),
            ),
            separatorComponent(),
            textComponent(`${botName()} by ᗯɪɴᴅꜱ™`),
          ],
        },
      ],
    } as never);
    return;
  }

  const isEmbedSend =
    command === "embed" && args[0]?.toLowerCase() === "send";
  const embedArgs = isEmbedSend ? args.slice(1) : args;
  const content = embedArgs.join(" ").trim();
  if (!content) {
    await message.reply(`Usage: \`${cmdPrefix()}${command} <message>\``);
    return;
  }

  if (!message.channel.isSendable()) {
    return;
  }

  if (command === "say") {
    await message.channel.send(content);
    return;
  }

  const sections =
    command === "embed"
      ? content.split(",").map((section) => section.trim()).filter(Boolean)
      : [];
  if (command === "embed") {
    // The image is optional. Text-only !embed send messages must use the same
    // Components V2 path and should never be blocked by attachment handling.
    const imageAttachment = [...message.attachments.values()].find(
      (attachment) =>
        attachment.contentType?.startsWith("image/") ||
        /\.(?:png|jpe?g|gif|webp|bmp)(?:$|\?)/i.test(attachment.url),
    );
    const title = sections.shift() ?? content;
    const footer = sections.length > 1 ? sections.pop() : undefined;
    const embedLines: RawDiscordComponent[] = [
      headingComponent(
        `# ${title.replace(/^#+\s*/, "")}`,
        imageAttachment?.url,
      ),
    ];

    for (const section of sections) {
      embedLines.push(separatorComponent(), textComponent(section));
    }

    if (footer) {
      embedLines.push(separatorComponent(), textComponent(footer));
    }

    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: 17,
          accent_color: embedColor,
          components: embedLines,
        },
      ],
    } as never);
    return;
  }

  await message.channel.send({ content } as never);
}

function currentTicket(message: Message) {
  if (!message.guild || message.channel.type !== ChannelType.GuildText) {
    return undefined;
  }

  const channel = message.channel as TextChannel;
  const info = ticketInfo(channel);
  return info ? { channel, info } : undefined;
}

function nextTicketNumber(
  guild: NonNullable<Message["guild"]>,
  categoryId: string,
) {
  const ticketChannels = guild.channels.cache.filter(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.parentId === categoryId &&
      Boolean(ticketInfo(channel)),
  );
  const highestNumber = ticketChannels.reduce((highest, channel) => {
    const match = channel.name.match(/^ticket-(\d+)$/);
    return Math.max(highest, match ? Number(match[1]) : 0);
  }, 0);
  return Math.max(ticketChannels.size, highestNumber) + 1;
}

async function ensureTicketSetup(
  guild: NonNullable<Message["guild"]>,
  botUserId: string,
) {
  const config = ticketConfig(guild.id);
  let category = config.categoryId
    ? guild.channels.cache.get(config.categoryId)
    : undefined;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.toLowerCase() === "tickets",
    );
  }
  if (!category) {
    category = await guild.channels.create({
      name: "Tickets",
      type: ChannelType.GuildCategory,
    });
  }

  let supportRole = config.supportRoleId
    ? guild.roles.cache.get(config.supportRoleId)
    : undefined;
  if (!supportRole) {
    supportRole = guild.roles.cache.find(
      (role) =>
        role.name.toLowerCase() === `${botName()} Support`.toLowerCase() ||
        role.name.toLowerCase() === "raze support",
    );
  }
  if (!supportRole) {
    supportRole = await guild.roles.create({
      name: `${botName()} Support`,
      color: 0x5865f2,
      mentionable: true,
      reason: `${botName()} Ticket System setup`,
    });
  }

  let logChannel = config.logChannelId
    ? guild.channels.cache.get(config.logChannelId)
    : undefined;
  if (!logChannel || logChannel.type !== ChannelType.GuildText) {
    logChannel = guild.channels.cache.find(
      (channel): channel is TextChannel =>
        channel.type === ChannelType.GuildText &&
        channel.name.toLowerCase() === "ticket-logs",
    );
  }
  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: "ticket-logs",
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: supportRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: botUserId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
      ],
    });
  }

  config.categoryId = category.id;
  config.supportRoleId = supportRole.id;
  config.logChannelId = logChannel.id;
  return config;
}

async function createTicket(
  guild: NonNullable<Message["guild"]>,
  userId: string,
  type: string,
  botUserId: string,
) {
  const config = ticketConfig(guild.id);
  const category = config.categoryId
    ? guild.channels.cache.get(config.categoryId)
    : undefined;
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(`Ticket system is not set up. Use ${cmdPrefix()}ticket setup first.`);
  }

  const existing = ticketChannelForUser(guild, userId);
  if (existing) {
    return { channel: existing, created: false };
  }

  const ticketNumber = nextTicketNumber(guild, category.id);
  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: botUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];
  if (config.supportRoleId) {
    permissionOverwrites.push({
      id: config.supportRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: ticketTopic({ ownerId: userId, type, status: "open" }),
    permissionOverwrites,
  });
  await sendTicketCard(
    channel,
    ticketChannelComponents(type, userId, "open", guild),
  );

  const logChannel = config.logChannelId
    ? guild.channels.cache.get(config.logChannelId)
    : undefined;
  if (logChannel?.type === ChannelType.GuildText) {
    await logChannel.send(
      `🎫 Ticket created: <#${channel.id}> by <@${userId}> (${ticketTypeLabel(type)})`,
    );
  }

  return { channel, created: true };
}

async function respondToTicketCommand(message: Message, args: string[]) {
  if (!message.guild) {
    await message.reply("Ticket commands can only be used inside a server.");
    return;
  }

  const action = args[0]?.toLowerCase() ?? "help";
  const isAdmin = isServerAdministratorOrOwner(message);
  const botUserId = message.client.user?.id;

  if (action === "setup") {
    if (!isAdmin) {
      await message.reply("Only the server owner or an administrator can set up tickets.");
      return;
    }
    if (!botUserId) {
      await message.reply(`${botName()} is still connecting. Please try again in a moment.`);
      return;
    }

    try {
      const config = await ensureTicketSetup(message.guild, botUserId);
      await message.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          {
            type: 17,
            accent_color: embedColor,
            components: [
              textComponent(`# 🎫 ${botName()} Ticket System Ready`),
              separatorComponent(),
              textComponent(
                [
                  `${whiteDotEmoji} **Support Role:** <@&${config.supportRoleId}>`,
                  `${whiteDotEmoji} **Ticket Category:** <#${config.categoryId}>`,
                  `${whiteDotEmoji} **Logs:** <#${config.logChannelId}>`,
                  "",
                  `Use \`${cmdPrefix()}ticket panel\` to send the ticket panel.`,
                ].join("\n"),
              ),
            ],
          },
        ],
      } as never);
    } catch (error) {
      logger.error({ err: error }, `${botName()} ticket setup failed`);
      await message.reply(
        `${botName()} could not set up tickets. Check my Manage Channels, Manage Roles, and View Channel permissions.`,
      );
    }
    return;
  }

  if (action === "customize") {
    if (!isAdmin) {
      await message.reply("Only the server owner or an administrator can customize the ticket panel.");
      return;
    }

    const field = args[1]?.toLowerCase();
    const panel = ticketPanelConfig(message.guild.id);
    const buttonType = args[2]?.toLowerCase() as TicketType | undefined;

    if (!field || field === "show") {
      await message.reply({
        flags: MessageFlags.IsComponentsV2,
        components: ticketCustomizationComponents(message.guild.id),
      } as never);
      return;
    }

    if (field === "reset") {
      const config = ticketConfig(message.guild.id);
      config.panel = defaultTicketPanelConfig();
      await message.reply("Ticket panel customization reset to the default design.");
      return;
    }

    if (field === "heading") {
      const value = args.slice(2).join(" ").trim();
      if (!value) {
        await message.reply(`Usage: \`${cmdPrefix()}ticket customize heading <text>\``);
        return;
      }
      panel.heading = value.startsWith("#") ? value : `# ${value}`;
      await message.reply(`Ticket panel heading updated. Run \`${cmdPrefix()}ticket panel\` to send the updated panel.`);
      return;
    }

    if (field === "center" || field === "description") {
      const value = args.slice(2).join(" ").trim();
      if (!value) {
        await message.reply(`Usage: \`${cmdPrefix()}ticket customize center <text>\``);
        return;
      }
      panel.description = value;
      await message.reply(`Ticket panel center text updated. Run \`${cmdPrefix()}ticket panel\` to send the updated panel.`);
      return;
    }

    if (field === "footer") {
      const value = args.slice(2).join(" ").trim();
      if (!value) {
        await message.reply(`Usage: \`${cmdPrefix()}ticket customize footer <text>\``);
        return;
      }
      panel.footer = value;
      await message.reply(`Ticket panel footer updated. Run \`${cmdPrefix()}ticket panel\` to send the updated panel.`);
      return;
    }

    if (field === "color") {
      const rawColor = args[2]?.replace(/^#/, "");
      if (!rawColor || !/^[\da-f]{6}$/i.test(rawColor)) {
        await message.reply(`Usage: \`${cmdPrefix()}ticket customize color <6-digit hex>\` — example: \`#5865F2\``);
        return;
      }
      panel.color = Number.parseInt(rawColor, 16);
      await message.reply(`Ticket panel accent color updated. Run \`${cmdPrefix()}ticket panel\` to send the updated panel.`);
      return;
    }

    if (
      field === "button" ||
      field === "emoji" ||
      field === "style" ||
      field === "toggle"
    ) {
      if (!buttonType || !Object.hasOwn(ticketTypeLabels, buttonType)) {
        await message.reply(
          `Choose a button type: ${Object.keys(ticketTypeLabels).map((type) => `\`${type}\``).join(", ")}`,
        );
        return;
      }

      const button = panel.buttons[buttonType];
      if (field === "button") {
        const label = args.slice(3).join(" ").trim();
        if (!label) {
          await message.reply(`Usage: \`${cmdPrefix()}ticket customize button <type> <label>\``);
          return;
        }
        button.label = label.slice(0, 80);
        await message.reply(`The ${buttonType} button label was updated.`);
        return;
      }

      if (field === "emoji") {
        const emoji = args.slice(3).join(" ").trim();
        if (!emoji) {
          await message.reply(`Usage: \`${cmdPrefix()}ticket customize emoji <type> <emoji|none>\``);
          return;
        }
        button.emoji = emoji.toLowerCase() === "none" ? undefined : emoji;
        await message.reply(`The ${buttonType} button emoji was updated.`);
        return;
      }

      if (field === "style") {
        const style = {
          primary: 1,
          secondary: 2,
          success: 3,
          danger: 4,
        }[args[3]?.toLowerCase() ?? ""];
        if (!style) {
          await message.reply("Choose a style: `primary`, `secondary`, `success`, or `danger`.");
          return;
        }
        button.style = style;
        await message.reply(`The ${buttonType} button style was updated.`);
        return;
      }

      const enabled = args[3]?.toLowerCase();
      if (enabled !== "on" && enabled !== "off") {
        await message.reply(`Usage: \`${cmdPrefix()}ticket customize toggle <type> <on|off>\``);
        return;
      }
      button.enabled = enabled === "on";
      await message.reply(`The ${buttonType} button is now ${button.enabled ? "enabled" : "disabled"}.`);
      return;
    }

    await message.reply(`Unknown customization. Use \`${cmdPrefix()}ticket customize show\` to view the available options.`);
    return;
  }

  if (action === "panel") {
    if (!isAdmin) {
      await message.reply(
        "Only the server owner or an administrator can build the ticket panel.",
      );
      return;
    }
    if (!ticketConfig(message.guild.id).categoryId) {
      await message.reply(`Use \`${cmdPrefix()}ticket setup\` first.`);
      return;
    }
    await message.reply({
      flags: MessageFlags.IsComponentsV2,
      components: ticketPanelBuilderComponents(),
    } as never);
    return;
  }

  if (action === "create") {
    if (!botUserId) {
      await message.reply(`${botName()} is still connecting. Please try again in a moment.`);
      return;
    }
    const requestedType = args[1]?.toLowerCase() || "general";
    if (!Object.hasOwn(ticketTypeLabels, requestedType)) {
      await message.reply(
        `Choose one: ${Object.keys(ticketTypeLabels).map((type) => `\`${type}\``).join(", ")}`,
      );
      return;
    }
    try {
      const result = await createTicket(
        message.guild,
        message.author.id,
        requestedType,
        botUserId,
      );
      await message.reply(
        result.created
          ? `Your ticket is ready: <#${result.channel.id}>`
          : `You already have an open ticket: <#${result.channel.id}>`,
      );
    } catch (error) {
      logger.error({ err: error }, `${botName()} ticket creation failed`);
      await message.reply(
        error instanceof Error
          ? error.message
          : `${botName()} could not create the ticket. Check my channel permissions.`,
      );
    }
    return;
  }

  if (action === "help") {
    await message.reply(
      [
        `**${botName()} Ticket Commands**`,
        `\`${cmdPrefix()}ticket setup\` — create the ticket category, support role, and logs`,
        `\`${cmdPrefix()}ticket panel\` — send the ticket panel`,
        `\`${cmdPrefix()}ticket customize show\` — view the current panel design`,
        `\`${cmdPrefix()}ticket customize ...\` — edit the heading, center text, footer, color, and buttons`,
        `\`${cmdPrefix()}ticket create [general|partnership|report|purchase|bug]\` — create a ticket`,
        `\`${cmdPrefix()}ticket close\` / \`${cmdPrefix()}ticket reopen\` — change ticket status`,
        `\`${cmdPrefix()}ticket claim\` — claim a ticket`,
        `\`${cmdPrefix()}ticket add @user\` / \`${cmdPrefix()}ticket remove @user\` — manage members`,
        `\`${cmdPrefix()}ticket rename <name>\` — rename the current ticket`,
        `\`${cmdPrefix()}ticket transcript\` — save the last 100 messages to logs`,
        `\`${cmdPrefix()}ticket delete\` — permanently delete the current ticket`,
      ].join("\n"),
    );
    return;
  }

  if (action === "config") {
    if (!isAdmin) {
      await message.reply("Only the server owner or an administrator can view ticket configuration.");
      return;
    }
    const config = ticketConfig(message.guild.id);
    await message.reply(
      [
        `**${botName()} Ticket Configuration**`,
        `Category: ${config.categoryId ? `<#${config.categoryId}>` : "Not set"}`,
        `Support role: ${config.supportRoleId ? `<@&${config.supportRoleId}>` : "Not set"}`,
        `Logs: ${config.logChannelId ? `<#${config.logChannelId}>` : "Not set"}`,
      ].join("\n"),
    );
    return;
  }

  const ticket = currentTicket(message);
  if (!ticket) {
    await message.reply(`This command must be used inside a ${botName()} ticket channel.`);
    return;
  }

  const { channel, info } = ticket;
  const isOwner = info.ownerId === message.author.id;
  const isStaff = isTicketStaff(message.guild, message.author.id);
  if (
    ["claim", "delete", "add", "remove", "rename"].includes(action) &&
    !isStaff
  ) {
    await message.reply(`Only the ticket owner or ${botName()} Support staff can use this ticket command.`);
    return;
  }
  if (["close", "reopen", "transcript"].includes(action) && !isOwner && !isStaff) {
    await message.reply(`Only the ticket owner or ${botName()} Support staff can use this ticket command.`);
    return;
  }

  if (action === "claim") {
    if (!isStaff) {
      await message.reply(`Only ${botName()} Support staff can claim tickets.`);
      return;
    }
    await channel.setTopic(
      ticketTopic({ ...info, claimedBy: message.author.id }),
    );
    await message.reply(`🎫 Ticket claimed by <@${message.author.id}>.`);
  } else if (action === "close") {
    await channel.setTopic(ticketTopic({ ...info, status: "closed" }));
    await channel.permissionOverwrites.edit(info.ownerId, {
      SendMessages: false,
    });
    await sendTicketCard(
      channel,
      ticketChannelComponents(info.type, info.ownerId, "closed", channel.guild),
    );
  } else if (action === "reopen") {
    await channel.setTopic(ticketTopic({ ...info, status: "open" }));
    await channel.permissionOverwrites.edit(info.ownerId, {
      SendMessages: true,
    });
    await sendTicketCard(
      channel,
      ticketChannelComponents(info.type, info.ownerId, "open", channel.guild),
    );
  } else if (action === "delete") {
    if (!isStaff) {
      await message.reply(`Only ${botName()} Support staff can delete tickets.`);
      return;
    }
    await channel.delete(`${botName()} ticket deleted`);
  } else if (action === "add" || action === "remove") {
    if (!isStaff) {
      await message.reply(`Only ${botName()} Support staff can manage ticket members.`);
      return;
    }
    const userId = userIdFromArgument(args[1]);
    if (!userId) {
      await message.reply(`Usage: \`${cmdPrefix()}ticket ${action} @user\``);
      return;
    }
    if (action === "add") {
      await channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
      });
      await message.reply(`<@${userId}> was added to this ticket.`);
    } else {
      await channel.permissionOverwrites.delete(userId);
      await message.reply(`<@${userId}> was removed from this ticket.`);
    }
  } else if (action === "rename") {
    const name = args
      .slice(1)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 85);
    if (!name) {
      await message.reply(`Usage: \`${cmdPrefix()}ticket rename <name>\``);
      return;
    }
    await channel.setName(`ticket-${name}`);
    await message.reply(`Ticket renamed to \`ticket-${name}\`.`);
  } else if (action === "transcript") {
    const messages = await channel.messages.fetch({ limit: 100 });
    const transcript = [...messages.values()]
      .reverse()
      .map((entry) => {
        const content = entry.content || "[no text]";
        const attachments = [...entry.attachments.values()]
          .map((attachment) => attachment.url)
          .join(" ");
        return `[${entry.createdAt.toISOString()}] ${entry.author.tag}: ${content}${attachments ? ` ${attachments}` : ""}`;
      })
      .join("\n");
    const logChannel = ticketConfig(message.guild.id).logChannelId
      ? message.guild.channels.cache.get(ticketConfig(message.guild.id).logChannelId!)
      : undefined;
    const destination =
      logChannel?.type === ChannelType.GuildText ? logChannel : channel;
    await destination.send({
      files: [
        {
          attachment: Buffer.from(transcript || "No messages found.", "utf8"),
          name: `${channel.name}-transcript.txt`,
        },
      ],
    });
    await message.reply("Transcript saved to the ticket logs.");
  } else {
    await message.reply(`Unknown ticket command. Use \`${cmdPrefix()}ticket help\`.`);
  }
}

function ticketBuilderIsAdmin(interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction) {
  const permissions = interaction.member?.permissions;
  return Boolean(
    interaction.guild &&
      (interaction.guild.ownerId === interaction.user.id ||
        (permissions &&
          typeof permissions !== "string" &&
          permissions.has(PermissionFlagsBits.Administrator))),
  );
}

async function handleTicketBuilderButton(interaction: ButtonInteraction) {
  if (!interaction.guild || !ticketBuilderIsAdmin(interaction)) {
    await interaction.reply({
      content: "Only the server owner or an administrator can build the ticket panel.",
      ephemeral: true,
    });
    return;
  }

  const action = interaction.customId.split(":")[3];
  if (action === "open") {
    await interaction.showModal(ticketBuilderModal());
    return;
  }

  if (action === "buttons") {
    const draft = ticketPanelDrafts.get(
      ticketPanelDraftKey(interaction.guild.id, interaction.user.id),
    );
    if (!draft) {
      await interaction.reply({
        content: `Your ticket panel form expired. Run \`${cmdPrefix()}ticket panel\` and try again.`,
        ephemeral: true,
      });
      return;
    }
    await interaction.showModal(ticketButtonConfigModal());
    return;
  }

  if (action !== "save") {
    return;
  }

  const draftKey = ticketPanelDraftKey(interaction.guild.id, interaction.user.id);
  const draft = ticketPanelDrafts.get(draftKey);
  if (
    !draft ||
    draft.buttons.length < 1 ||
    draft.buttons.length > 5 ||
    draft.buttons.some((button) => button.style === undefined)
  ) {
    await interaction.reply({
      content: "Choose a colour for every configured button before submitting.",
      ephemeral: true,
    });
    return;
  }

  const invalidEmoji = draft.buttons.find(
    (button) =>
      button.emoji &&
      !ticketEmojiPayload(button.emoji, interaction.guild ?? undefined),
  );
  if (invalidEmoji) {
    await interaction.reply({
      content:
        `I could not find ${invalidEmoji.emoji} in this server. ` +
        "Use a Unicode emoji or the full custom format `<a:name:id>` / `<:name:id>`.",
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel?.isSendable()) {
    await interaction.reply({
      content: `${botName()} cannot send the ticket panel in this channel.`,
      ephemeral: true,
    });
    return;
  }

  let panelDraft = draft;
  let logoAttachment:
    | { attachment: Buffer; name: string }
    | undefined;
  if (draft.logoUrl) {
    try {
      logoAttachment = await downloadTicketLogo(draft.logoUrl);
      panelDraft = {
        ...draft,
        logoUrl: `attachment://${logoAttachment.name}`,
      };
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : `${botName()} could not download that logo image.`,
        ephemeral: true,
      });
      return;
    }
  }

  const panel = ticketPanelConfig(interaction.guild.id);
  const heading = replaceNamedEmojiMarkup(draft.heading, interaction.guild);
  panel.heading = heading.startsWith("#") ? heading : `# ${heading}`;
  panel.description = draft.message;
  panel.footer = draft.end;
  panel.color = embedColor;
  const ticketTypes = Object.keys(ticketTypeLabels) as TicketType[];
  for (const [type, button] of Object.entries(panel.buttons) as [
    TicketType,
    TicketButtonConfig,
  ][]) {
    button.enabled = false;
    button.emoji = undefined;
  }
  draft.buttons.forEach((buttonDraft, index) => {
    const type = ticketTypes[index];
    if (!type) {
      return;
    }
    panel.buttons[type].enabled = true;
    panel.buttons[type].label = buttonDraft.label;
    panel.buttons[type].emoji = buttonDraft.emoji;
    panel.buttons[type].style = buttonDraft.style ?? 2;
  });

  await interaction.update({
    content: "Ticket panel submitted. The embed is below.",
    components: [],
  });
  const sentPanel = await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: configuredTicketPanelComponents(panelDraft, interaction.guild),
    ...(logoAttachment ? { files: [logoAttachment] } : {}),
  } as never);
  panel.logoUrl = sentPanel.attachments.first()?.url ?? draft.logoUrl;
  ticketPanelDrafts.delete(draftKey);
}

async function handleTicketBuilderModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guild || !ticketBuilderIsAdmin(interaction)) {
    await interaction.reply({
      content: "Only the server owner or an administrator can build the ticket panel.",
      ephemeral: true,
    });
    return;
  }

  const logoValue = interaction.fields.getTextInputValue("logo").trim();
  let logoUrl: string | undefined;
  if (logoValue) {
    try {
      const parsed = new URL(logoValue);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      logoUrl = parsed.toString();
    } catch {
      await interaction.reply({
        content: "The logo must be a valid image URL beginning with http:// or https://.",
        ephemeral: true,
      });
      return;
    }
  }

  ticketPanelDrafts.set(
    ticketPanelDraftKey(interaction.guild.id, interaction.user.id),
    {
      heading: interaction.fields.getTextInputValue("heading").trim(),
      message: interaction.fields.getTextInputValue("message").trim(),
      logoUrl,
      buttons: [],
      end: interaction.fields.getTextInputValue("end").trim(),
    },
  );

  await interaction.reply({
    content:
      "Now configure each button in its own box. Leave unused boxes empty, then submit.",
    components: [ticketBuilderButtonsRow()],
    ephemeral: true,
  });
}

async function handleTicketBuilderButtonsModal(
  interaction: ModalSubmitInteraction,
) {
  if (!interaction.guild || !ticketBuilderIsAdmin(interaction)) {
    await interaction.reply({
      content: "Only the server owner or an administrator can build the ticket panel.",
      ephemeral: true,
    });
    return;
  }

  const draft = ticketPanelDrafts.get(
    ticketPanelDraftKey(interaction.guild.id, interaction.user.id),
  );
  if (!draft) {
    await interaction.reply({
      content: `Your ticket panel form expired. Run \`${cmdPrefix()}ticket panel\` and try again.`,
      ephemeral: true,
    });
    return;
  }

  let buttons: TicketPanelDraft["buttons"];
  try {
    buttons = ticketButtonDrafts(
      [1, 2, 3, 4, 5]
        .map((number) =>
          interaction.fields.getTextInputValue(`button-${number}`).trim(),
        )
        .join("\n"),
    );
  } catch (error) {
    await interaction.reply({
      content:
        error instanceof Error ? error.message : "Configure at least one button.",
      ephemeral: true,
    });
    return;
  }

  draft.buttons = buttons;
  await interaction.reply({
    content:
      "Choose a colour for Button 1. The colour selector advances one button at a time.",
    components: [ticketButtonColorRow(0)],
    ephemeral: true,
  });
}

async function handleTicketBuilderButtonColor(
  interaction: StringSelectMenuInteraction,
) {
  if (!interaction.guild || !ticketBuilderIsAdmin(interaction)) {
    await interaction.reply({
      content: "Only the server owner or an administrator can build the ticket panel.",
      ephemeral: true,
    });
    return;
  }

  const index = Number(interaction.customId.split(":").at(-1));
  const draft = ticketPanelDrafts.get(
    ticketPanelDraftKey(interaction.guild.id, interaction.user.id),
  );
  const selected = ticketButtonColorOptions.find(
    (option) => option.value === interaction.values[0],
  );
  if (
    !draft ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= draft.buttons.length ||
    !selected
  ) {
    await interaction.reply({
      content: `Your ticket panel form expired. Run \`${cmdPrefix()}ticket panel\` and try again.`,
      ephemeral: true,
    });
    return;
  }

  draft.buttons[index].style = selected.style;
  const nextIndex = index + 1;
  if (nextIndex < draft.buttons.length) {
    await interaction.update({
      content: `Button ${index + 1} is ${selected.label}. Choose a colour for Button ${nextIndex + 1}.`,
      components: [ticketButtonColorRow(nextIndex)],
    });
    return;
  }

  await interaction.update({
    content: "All button colours are set. Press Submit to send the ticket panel.",
    components: [ticketBuilderSubmitRow()],
  });
}

async function handleTicketButton(interaction: ButtonInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Tickets can only be used inside a server.",
      ephemeral: true,
    });
    return;
  }

  const parts = interaction.customId.split(":");
  const action = parts[2];
  const type = parts[3];
  const botUserId = interaction.client.user?.id;

  if (action === "create") {
    if (!botUserId || !type || !Object.hasOwn(ticketTypeLabels, type)) {
      await interaction.reply({
        content: `${botName()} could not create that ticket type.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await createTicket(
        interaction.guild,
        interaction.user.id,
        type,
        botUserId,
      );
      await interaction.editReply(
        result.created
          ? `Your ticket is ready: <#${result.channel.id}>`
          : `You already have an open ticket: <#${result.channel.id}>`,
      );
    } catch (error) {
      logger.error({ err: error }, `${botName()} ticket button creation failed`);
      await interaction.editReply(
        error instanceof Error
          ? error.message
          : `${botName()} could not create that ticket.`,
      );
    }
    return;
  }

  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "This ticket action must be used inside a ticket channel.",
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.channel as TextChannel;
  const info = ticketInfo(channel);
  if (!info) {
    await interaction.reply({
      content: `This is not a ${botName()} ticket channel.`,
      ephemeral: true,
    });
    return;
  }

  const isStaff = isTicketStaff(interaction.guild, interaction.user.id);
  const isOwner = info.ownerId === interaction.user.id;
  if (action === "claim" && !isStaff) {
    await interaction.reply({
      content: `Only ${botName()} Support staff can claim tickets.`,
      ephemeral: true,
    });
    return;
  }
  if ((action === "close" || action === "reopen") && !isStaff && !isOwner) {
    await interaction.reply({
      content: `Only the ticket owner or ${botName()} Support staff can change ticket status.`,
      ephemeral: true,
    });
    return;
  }
  if (action === "delete" && !isStaff) {
    await interaction.reply({
      content: `Only ${botName()} Support staff can delete tickets.`,
      ephemeral: true,
    });
    return;
  }

  if (action === "claim") {
    await channel.setTopic(ticketTopic({ ...info, claimedBy: interaction.user.id }));
    await interaction.reply({
      content: `🎫 Ticket claimed by <@${interaction.user.id}>.`,
      ephemeral: false,
    });
  } else if (action === "close") {
    await channel.setTopic(ticketTopic({ ...info, status: "closed" }));
    await channel.permissionOverwrites.edit(info.ownerId, {
      SendMessages: false,
    });
    await interaction.reply({
      content: "Ticket closed.",
      ephemeral: true,
    });
    await sendTicketCard(
      channel,
      ticketChannelComponents(info.type, info.ownerId, "closed", channel.guild),
    );
  } else if (action === "reopen") {
    await channel.setTopic(ticketTopic({ ...info, status: "open" }));
    await channel.permissionOverwrites.edit(info.ownerId, {
      SendMessages: true,
    });
    await interaction.reply({
      content: "Ticket reopened.",
      ephemeral: true,
    });
    await sendTicketCard(
      channel,
      ticketChannelComponents(info.type, info.ownerId, "open", channel.guild),
    );
  } else if (action === "delete") {
    await interaction.reply({
      content: "Deleting this ticket...",
      ephemeral: true,
    });
    await channel.delete(`${botName()} ticket deleted`);
  }
}

async function respondToSecurityCommand(
  message: Message,
  command: string,
  args: string[],
) {
  if (!message.guild) {
    await message.reply(
      "Z+ Security commands can only be used inside a server.",
    );
    return;
  }

  if (!isServerAdministratorOrOwner(message)) {
    await message.reply(
      "Only the server owner or an administrator can use Z+ Security commands.",
    );
    return;
  }

  const state = guildSecurityState(message.guild.id);
  const action = args[0]?.toLowerCase();

  if (command === "antinuke") {
    if (action === "enable") {
      state.enabled = true;
      await respondToSecurityCard(message, `**${botName()} - Z+ Security** ${greenRoleIconEmoji}`, [
        `${griffonStarEmoji} **Status :** \`Enabled\``,
      ]);
    } else if (action === "disable") {
      state.enabled = false;
      await respondToSecurityCard(message, `**${botName()} - Z+ Security** ${greenRoleIconEmoji}`, [
        `${griffonStarEmoji} **Status :** \`Disabled\``,
      ]);
    } else if (action === "status") {
      await respondToSecurityCard(message, `**${botName()} - Z+ Security** ${greenRoleIconEmoji}`, [
        `${griffonStarEmoji} **Antinuke :** \`${securityStatus(message.guild.id)}\``,
      ]);
    } else if (action === "events") {
      await message.reply({
        flags: MessageFlags.IsComponentsV2,
        components: protectedEventsComponents(0),
      } as never);
    } else {
      await message.reply(
        `Usage: \`${cmdPrefix()}antinuke enable\`, \`${cmdPrefix()}antinuke disable\`, \`${cmdPrefix()}antinuke status\`, or \`${cmdPrefix()}antinuke events\``,
      );
    }
    return;
  }

  const collection =
    command === "whitelist" ? state.whitelist : state.extraOwners;
  const collectionName = command === "whitelist" ? "Whitelist" : "Extra-owners";

  if (action === "show") {
    if (command === "whitelist") {
      await message.reply({
        flags: MessageFlags.IsComponentsV2,
        components: await whitelistShowComponents(
          message.client,
          message.guild.id,
          0,
        ),
      } as never);
    } else if (command === "extraowner") {
      await message.reply({
        flags: MessageFlags.IsComponentsV2,
        components: await extraOwnerShowComponents(
          message.client,
          message.guild.id,
        ),
      } as never);
    } else {
      const entries = [...collection].map((userId) => `<@${userId}>`);
      await message.reply(
        `**${collectionName}**\n${entries.length > 0 ? entries.join("\n") : "No users added."}`,
      );
    }
  } else if (action === "add" || action === "remove") {
    const userId = userIdFromArgument(args[1]);
    if (!userId) {
      await message.reply(
        `Usage: \`${cmdPrefix()}${command} ${action} @user\``,
      );
      return;
    }

    if (action === "add") {
      collection.add(userId);
      if (command === "whitelist") {
        const username = await whitelistUserName(message, userId);
        await respondToSecurityCard(message, `**${botName()} - Whitelist Added** ${catNotedEmoji}`, [
          "**__Whitelisted__**",
          "",
          `${griffonStarEmoji} **USER :** \`${username}\``,
          `${griffonStarEmoji} **Status :** \`Whitelisted\``,
          `${griffonStarEmoji} **Module :** \`24-Active\``,
        ]);
      } else {
        await message.reply(`<@${userId}> was added to the ${collectionName}.`);
      }
    } else {
      collection.delete(userId);
      if (command === "whitelist") {
        const username = await whitelistUserName(message, userId);
        await respondToSecurityCard(message, `**${botName()} - Whitelist Removed** ${catNotedEmoji}`, [
          "**__Outlisted__**",
          "",
          `${griffonStarEmoji} **USER :** \`${username}\``,
          `${griffonStarEmoji} **Status :** \`Removed\``,
          `${griffonStarEmoji} **Module :** \`24-Deactive\``,
        ]);
      } else {
        await message.reply(`<@${userId}> was removed from the ${collectionName}.`);
      }
    }
  } else {
    await message.reply(
      `Usage: \`${cmdPrefix()}${command} add @user\`, \`${cmdPrefix()}${command} remove @user\`, or \`${cmdPrefix()}${command} show\``,
    );
  }
}

async function respondToHelpOnce(
  requestId: string,
  respond: () => Promise<unknown>,
) {
  if (handledHelpRequestIds.has(requestId)) {
    return;
  }

  handledHelpRequestIds.add(requestId);
  try {
    await respond();
  } catch (error) {
    handledHelpRequestIds.delete(requestId);
    throw error;
  }
}

async function handleCategorySelection(
  interaction: StringSelectMenuInteraction,
) {
  const category = interaction.values[0] ?? "bot";
  await interaction.deferUpdate();
  await interaction.message.delete();
  if (!interaction.channel?.isSendable()) {
    return;
  }

  const components =
    category === "security"
      ? securityCategoryComponents(
          interaction.guild?.id,
          interaction.guild?.name ?? "Direct Message",
        )
      : makeCategoryResponseComponents(interaction.user, category);

  await interaction.channel.send({
    flags: MessageFlags.IsComponentsV2,
    components,
  } as never);
}

async function handleHelpPagesButton(interaction: ButtonInteraction) {
  const [, , action, rawPage] = interaction.customId.split(":");
  const currentPage = Number(rawPage);

  if (action === "trash") {
    await interaction.deferUpdate();
    await interaction.message.delete();
    return;
  }

  if (!Number.isInteger(currentPage)) {
    return;
  }

  const nextPage =
    action === "previous" ? currentPage - 1 : currentPage + 1;
  await interaction.deferUpdate();
  await interaction.message.edit({
    components: makeHelpComponents(
      interaction.user,
      interaction.guild?.name ?? "Direct Message",
      cmdPrefix(),
      undefined,
      servingUserCount(interaction.client),
      nextPage,
    ),
  } as never);
}

async function handleBotCommandsButton(interaction: ButtonInteraction) {
  const [, , action, rawPage] = interaction.customId.split(":");
  const currentPage = Number(rawPage);

  if (action === "trash") {
    await interaction.deferUpdate();
    await interaction.message.delete();
    return;
  }

  if (!Number.isInteger(currentPage)) {
    return;
  }

  const nextPage =
    action === "previous" ? currentPage - 1 : currentPage + 1;
  await interaction.deferUpdate();
  await interaction.message.edit({
    components: botCategoryComponents(interaction.user, nextPage),
  } as never);
}

async function handleModerationCommandsButton(interaction: ButtonInteraction) {
  const [, , action, rawPage] = interaction.customId.split(":");
  const currentPage = Number(rawPage);

  if (action === "trash") {
    await interaction.deferUpdate();
    await interaction.message.delete();
    return;
  }

  if (!Number.isInteger(currentPage)) {
    return;
  }

  const nextPage =
    action === "previous" ? currentPage - 1 : currentPage + 1;
  await interaction.deferUpdate();
  await interaction.message.edit({
    components: moderationCategoryComponents(interaction.user, nextPage),
  } as never);
}

async function handleSecurityCategoryButton(interaction: ButtonInteraction) {
  const [, , action, rawPage] = interaction.customId.split(":");
  const currentPage = Number(rawPage);

  if (action === "trash") {
    await interaction.deferUpdate();
    await interaction.message.delete();
    return;
  }

  if (!Number.isInteger(currentPage)) {
    return;
  }

  const nextPage =
    action === "previous" ? currentPage - 1 : currentPage + 1;
  await interaction.deferUpdate();
  await interaction.message.edit({
    components: securityCategoryComponents(
      interaction.guild?.id,
      interaction.guild?.name ?? "Direct Message",
      nextPage,
    ),
  } as never);
}

async function handleProtectedEventsButton(interaction: ButtonInteraction) {
  const [, , action, rawPage] = interaction.customId.split(":");
  const currentPage = Number(rawPage);

  if (action === "trash") {
    await interaction.message.delete();
    return;
  }

  if (!Number.isInteger(currentPage)) {
    return;
  }

  const nextPage =
    action === "previous" ? currentPage - 1 : currentPage + 1;
  await interaction.deferUpdate();
  await interaction.message.edit({
    components: protectedEventsComponents(nextPage),
  } as never);
}

async function handleWhitelistShowButton(interaction: ButtonInteraction) {
  const [, , action, rawPage] = interaction.customId.split(":");
  const currentPage = Number(rawPage);

  if (action === "trash") {
    await interaction.deferUpdate();
    await interaction.message.delete();
    return;
  }

  if (!interaction.guildId || !Number.isInteger(currentPage)) {
    return;
  }

  const nextPage =
    action === "previous" ? currentPage - 1 : currentPage + 1;
  await interaction.deferUpdate();
  await interaction.message.edit({
    components: await whitelistShowComponents(
      interaction.client,
      interaction.guildId,
      nextPage,
    ),
  } as never);
}

export async function startRazeBot() {
  if (botStarted) {
    logger.warn("startRazeBot called twice; ignoring the duplicate login attempt");
    return;
  }
  botStarted = true;

  if (!token) {
    throw new Error(
      `DISCORD_BOT_TOKEN is missing. Add it to the project secrets before starting ${botName()}.`,
    );
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildInvites,
    ],
  });

  activeClient = client;
  await initExtras(client);

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, "ZAIR Discord client error");
  });

  client.on(Events.Warn, (info) => {
    logger.warn({ info }, "ZAIR Discord client warning");
  });

  client.on(Events.ShardDisconnect, (event, shardId) => {
    botReady = false;
    logger.warn(
      { code: event.code, shardId },
      "ZAIR gateway disconnected; discord.js will reconnect automatically",
    );
  });

  client.on(Events.ShardReconnecting, (shardId) => {
    logger.warn({ shardId }, "ZAIR gateway reconnecting");
  });

  client.on(Events.ShardReady, (shardId) => {
    botReady = true;
    logger.info({ shardId }, "ZAIR gateway shard ready");
  });

  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    botReady = true;
    logger.info({ shardId, replayedEvents }, "ZAIR gateway session resumed");
  });

  client.on(Events.ShardError, (error, shardId) => {
    logger.error({ err: error, shardId }, "ZAIR gateway shard error");
  });

  client.on(Events.Invalidated, () => {
    logger.fatal("ZAIR Discord session was invalidated; exiting so Render restarts the service");
    process.exit(1);
  });

  client.once(Events.ClientReady, async (readyClient) => {
    botReady = true;
    logger.info(
      { guildCount: readyClient.guilds.cache.size },
      "ZAIR Discord client ready",
    );
    try {
      await removeOldCommands(
        readyClient.user.id,
        readyClient.guilds.cache.map((guild) => guild.id),
      );
      applyBotPresence(readyClient);
      logger.info(
        { user: readyClient.user.tag },
        `${botName()} online with Do Not Disturb presence`,
      );
    } catch (error) {
      logger.error({ err: error }, `${botName()} startup sync failed`);
    }
  });

  client.on(Events.UserUpdate, async (oldUser, newUser) => {
    if (!client.isReady() || newUser.id !== client.user.id) {
      return;
    }

    if (oldUser.username !== newUser.username) {
      try {
        applyBotPresence(client);
        await removeOldCommands(
          client.user.id,
          client.guilds.cache.map((guild) => guild.id),
        );
        logger.info({ name: botName() }, "Bot name changed; presence and /help refreshed");
      } catch (error) {
        logger.warn({ err: error }, "Could not refresh presence after a name change");
      }
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    if (!client.isReady()) {
      return;
    }

    const avatarUrl = client.user.displayAvatarURL({
      extension: "png",
      size: 512,
    });
    const welcomeComponents = razeAddedWelcomeComponents(guild, avatarUrl);

    const announcementChannel = findAnnouncementChannel(guild);
    if (announcementChannel) {
      try {
        await announcementChannel.send({
          flags: MessageFlags.IsComponentsV2,
          components: welcomeComponents,
        } as never);
        logger.info(
          { guildId: guild.id, channelId: announcementChannel.id },
          `${botName()} sent server welcome message`,
        );
      } catch (error) {
        logger.warn(
          { err: error, guildId: guild.id },
          `${botName()} could not send the server welcome message`,
        );
      }
    } else {
      logger.warn(
        { guildId: guild.id },
        `${botName()} found no writable text channel for the server welcome message`,
      );
    }

    try {
      const owner = await guild.fetchOwner();
      await owner.send({
        flags: MessageFlags.IsComponentsV2,
        components: welcomeComponents,
      } as never);
      logger.info(
        { guildId: guild.id, ownerId: owner.id },
        `${botName()} sent server welcome DM fallback`,
      );
    } catch (error) {
      logger.warn(
        { err: error, guildId: guild.id },
        `${botName()} could not send the server welcome DM fallback`,
      );
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    if (client.user?.id === member.user.id) {
      return;
    }

    await sendMemberEventCard("welcome", member);
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    if (!client.user || member.user.id !== client.user.id) {
      await sendMemberEventCard("leave", member);
      return;
    }

    const announcementChannel = findAnnouncementChannel(member.guild);
    if (!announcementChannel) {
      return;
    }

    try {
      await announcementChannel.send({
        flags: MessageFlags.IsComponentsV2,
        components: razeLeftGuildComponents(
          member.guild.name,
          client.user.displayAvatarURL({ extension: "png", size: 512 }),
        ),
      } as never);
      logger.info(
        { guildId: member.guild.id, channelId: announcementChannel.id },
        `${botName()} sent server goodbye message`,
      );
    } catch (error) {
      logger.warn(
        { err: error, guildId: member.guild.id },
        `${botName()} could not send the server goodbye message`,
      );
    }
  });

  client.on(Events.GuildDelete, async (guild) => {
    try {
      const owner = await client.users.fetch(guild.ownerId);
      await owner.send({
        flags: MessageFlags.IsComponentsV2,
        components: razeLeftGuildComponents(
          guild.name,
          client.user?.displayAvatarURL({ extension: "png", size: 512 }) ?? "",
        ),
      } as never);
      logger.info(
        { guildId: guild.id, ownerId: owner.id },
        `${botName()} sent server goodbye DM fallback`,
      );
    } catch (error) {
      logger.warn(
        { err: error, guildId: guild.id },
        `${botName()} could not send the server goodbye DM fallback`,
      );
    }
  });

  client.on(Events.InteractionCreate, (interaction) =>
    prefixContext.run({ prefix: getPrefix(interaction.guildId ?? undefined) }, async () => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "help") {
        await respondToHelpOnce(interaction.id, () =>
          respondToSlashHelp(interaction),
        );
      } else if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith("raze:help-category:")
      ) {
        await handleCategorySelection(interaction);
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("raze:help-pages:")
      ) {
        await handleHelpPagesButton(interaction);
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("raze:ticket:builder:")
      ) {
        await handleTicketBuilderButton(interaction);
      } else if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith("raze:ticket:builder:button-color:")
      ) {
        await handleTicketBuilderButtonColor(interaction);
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "raze:ticket:builder:form") {
          await handleTicketBuilderModal(interaction);
        } else if (
          interaction.customId === "raze:ticket:builder:buttons-form"
        ) {
          await handleTicketBuilderButtonsModal(interaction);
        }
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("raze:ticket:")
      ) {
        await handleTicketButton(interaction);
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("raze:bot-commands:")
      ) {
        await handleBotCommandsButton(interaction);
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("raze:moderation-commands:")
      ) {
        await handleModerationCommandsButton(interaction);
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("raze:security-commands:")
      ) {
        await handleSecurityCategoryButton(interaction);
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("raze:protected-events:")
      ) {
        await handleProtectedEventsButton(interaction);
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("raze:whitelist-show:")
      ) {
        await handleWhitelistShowButton(interaction);
      }
    } catch (error) {
      logger.error({ err: error }, `${botName()} interaction failed`);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: `${botName()} could not open this panel. Please try again.`,
            ephemeral: true,
          });
        } catch (fallbackError) {
          logger.warn({ err: fallbackError }, `${botName()} could not send interaction error response`);
        }
      }
    }
  }));

  client.on(Events.MessageCreate, (message) =>
    prefixContext.run({ prefix: getPrefix(message.guild?.id) }, async () => {
    try {
      if (message.author.bot) {
        return;
      }

      if (await moderateMessage(message)) {
        return;
      }

      if (messageMentionsUser(message, reactionTargetUserId)) {
        await Promise.allSettled(
          reactionEmojis.map((emoji) => message.react(emoji)),
        );
      }

      await trackMessage(message).catch((error) => {
        logger.warn({ err: error }, "Message tracking failed");
      });

      const botUserId = message.client.user?.id;
      const botMentionPattern = botUserId
        ? new RegExp(`^<@!?${botUserId}>\\s*`)
        : undefined;
      const commandContent = botMentionPattern
        ? message.content.trim().replace(botMentionPattern, "").trim()
        : message.content.trim();

      const activePrefix = getPrefix(message.guild?.id);
      if (
        botMentionPattern &&
        commandContent === "" &&
        botMentionPattern.test(message.content.trim())
      ) {
        await message.reply({
          content: `Hey ${message.author}, my prefix here is \`${activePrefix}\` — use \`${activePrefix}help\` to see all my commands.`,
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      const hasPrefix = commandContent.startsWith(activePrefix);
      if (!hasPrefix && !hasNoPrefixAccess(message.author.id)) {
        return;
      }

      const [command, ...args] = commandContent
        .slice(hasPrefix ? activePrefix.length : 0)
        .trim()
        .split(/\s+/);
      const normalizedCommand = resolveCommandAlias(
        command?.toLowerCase(),
        hasPrefix,
      );
      if (isExtraCommand(normalizedCommand)) {
        await respondToHelpOnce(message.id, async () =>
          respondToExtraCommand(message, normalizedCommand as string, args),
        );
      } else if (normalizedCommand === "ap") {
        await respondToHelpOnce(message.id, async () =>
          respondToPremiumActivate(message, args),
        );
      } else if (normalizedCommand === "rp") {
        await respondToHelpOnce(message.id, async () =>
          respondToPremiumRemove(message, args),
        );
      } else if (normalizedCommand === "np") {
        await respondToHelpOnce(message.id, async () =>
          respondToNoPrefixCommand(message, args),
        );
      } else if (normalizedCommand === "help") {
        await respondToHelpOnce(message.id, async () =>
          respondToPrefixHelp(message),
        );
      } else if (normalizedCommand === "stats") {
        await respondToHelpOnce(message.id, async () =>
          respondToPrefixStats(message),
        );
      } else if (
        normalizedCommand === "ping" ||
        normalizedCommand === "pong"
      ) {
        await respondToHelpOnce(message.id, async () =>
          respondToPrefixPing(message),
        );
      } else if (normalizedCommand === "premium") {
        await respondToHelpOnce(message.id, async () =>
          respondToPrefixPremium(message),
        );
      } else if (normalizedCommand === "uptime") {
        await respondToHelpOnce(message.id, async () =>
          respondToPrefixUptime(message),
        );
      } else if (normalizedCommand === "automod") {
        await respondToHelpOnce(message.id, async () =>
          respondToAutoModCommand(message, args),
        );
      } else if (
        normalizedCommand === "ban" ||
        normalizedCommand === "kick" ||
        normalizedCommand === "mute"
      ) {
        await respondToHelpOnce(message.id, async () =>
          respondToModerationCommand(message, normalizedCommand, args),
        );
      } else if (normalizedCommand === "unban") {
        await respondToHelpOnce(message.id, async () =>
          respondToUnbanCommand(message, args),
        );
      } else if (normalizedCommand === "unmute") {
        await respondToHelpOnce(message.id, async () =>
          respondToUnmuteCommand(message, args),
        );
      } else if (normalizedCommand === "rape") {
        await respondToHelpOnce(message.id, async () =>
          respondToUnsafeRapeCommand(message),
        );
      } else if (
        normalizedCommand === "say" ||
        normalizedCommand === "embed" ||
        normalizedCommand === "dm"
      ) {
        await respondToHelpOnce(message.id, async () =>
          respondToBotUtilityCommand(message, normalizedCommand, args),
        );
      } else if (normalizedCommand === "ticket") {
        await respondToHelpOnce(message.id, async () =>
          respondToTicketCommand(message, args),
        );
      } else if (normalizedCommand === "welcomer") {
        await respondToHelpOnce(message.id, async () =>
          respondToMemberEventCommand(message, args, "welcome"),
        );
      } else if (normalizedCommand === "leaver") {
        await respondToHelpOnce(message.id, async () =>
          respondToMemberEventCommand(message, args, "leave"),
        );
      } else if (
        normalizedCommand === "antinuke" ||
        normalizedCommand === "whitelist" ||
        normalizedCommand === "extraowner"
      ) {
        await respondToHelpOnce(message.id, async () =>
          respondToSecurityCommand(message, normalizedCommand, args),
        );
      }
    } catch (error) {
      logger.error({ err: error }, `${botName()} prefix command failed`);
    }
  }));

  logger.info("ZAIR connecting to the Discord gateway");
  await client.login(token);
  logger.info("ZAIR gateway login accepted");
}