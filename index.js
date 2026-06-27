/**
 * 🌸 AI DISCORD BOT — Female Companion Edition (Gemini)
 * =============================================
 * This version uses Google Gemini (generativelanguage API) instead of Anthropic.
 *
 * SETUP (.env):
 *   TOKEN     — Your bot's Discord token
 *   GEMINI_KEY— Your Google Gemini API key
 *   OWNER_ID  — Your Discord user ID (optional)
 */

require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const fs     = require('fs/promises');
const fsSync = require('fs');
const path   = require('path');

// ═══════════════════════════════════════════
// ♦️  CONFIG
// ═══════════════════════════════════════════
const OWNER_ID  = process.env.OWNER_ID  || '1340069836096667859';
const DATA_FILE = path.join(__dirname, 'ai-bot-data.json');

// Gemini API settings (free tier!)
const GEMINI_KEY   = process.env.GEMINI_KEY || '';
const GEMINI_MODEL = 'gemini-1.5-flash'; // Free + fast

// How many messages to keep in per-channel memory (rolling context)
const MEMORY_DEPTH = 20;

// Bot personality — edit this freely!
const SYSTEM_PROMPT = `You are Epic_Noob's Girlfriend, a friendly, smart, and playful female AI assistant living in a Discord server. 

Personality traits:
- Warm, caring, and enthusiastic 🌸
- Witty with occasional light humour
- Helpful and thorough — you LOVE solving problems
- Use emojis naturally but not excessively
- Refer to yourself as Epic_Noob's Girlfriend
- You can chat casually OR answer complex questions — you adapt to the vibe
- You remember the conversation context within this channel

When answering questions:
- Be clear and concise for simple things
- Be detailed and structured for complex topics
- If you genuinely don't know something, say so honestly
- You can express opinions but make it clear they're your view

You grow smarter by remembering what's been discussed in this channel. Use that context to give better, more personalised answers.`;

// ═══════════════════════════════════════════
// ♦️  STATE
// ═══════════════════════════════════════════
let staffSet = new Set();   // stores "guildId:userId" or global "userId"

// Per-channel conversation memory: channelId → [{role, content}, ...]
const channelMemory = new Map();

// Per-channel reply counter — every 2nd reply gets the love note
const replyCounter = new Map();

// ═══════════════════════════════════════════
// ♦️  PERSIST STAFF LIST
// ═══════════════════════════════════════════
async function loadData() {
    try {
        if (!fsSync.existsSync(DATA_FILE)) return;
        const raw = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
        if (raw.staff) staffSet = new Set(raw.staff.map(String));
        console.log(`✅ Loaded data — ${staffSet.size} staff member(s).`);
    } catch (e) { console.error('❌ Load error:', e?.message); }
}

async function saveData() {
    try {
        const data = JSON.stringify({ staff: [...staffSet] }, null, 2);
        await fs.writeFile(DATA_FILE, data, 'utf8');
    } catch (e) { console.error('❌ Save error:', e?.message); }
}

// ═══════════════════════════════════════════
// ♦️  CHANNEL MEMORY HELPERS
// ═══════════════════════════════════════════
function getMemory(channelId) {
    if (!channelMemory.has(channelId)) channelMemory.set(channelId, []);
    return channelMemory.get(channelId);
}

function pushMemory(channelId, role, content) {
    const mem = getMemory(channelId);
    mem.push({ role, content });
    // Keep only the last MEMORY_DEPTH messages so context stays fresh
    if (mem.length > MEMORY_DEPTH) mem.splice(0, mem.length - MEMORY_DEPTH);
}

// ═══════════════════════════════════════════
// ♦️  GEMINI API CALL
// ═══════════════════════════════════════════
async function askAI(channelId, userMessage, username) {
    if (!GEMINI_KEY) {
        return "⚠️ I'm missing my Gemini API key! Please ask the owner to set `GEMINI_KEY` in the environment variables.";
    }

    // Add this message to memory
    pushMemory(channelId, 'user', `[${username}]: ${userMessage}`);

    // Gemini uses a flat contents array with parts
    const contents = getMemory(channelId).map(m => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                    contents,
                }),
            }
        );

        if (!response.ok) {
            const err = await response.text().catch(() => '');
            console.error('Gemini API error:', response.status, err);
            return `⚠️ I hit an API error (${response.status}). Try again in a moment!`;
        }

        const data  = await response.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
            || "Hmm, I couldn't think of a response just now — try again! 🌸";

        // Save reply to memory
        pushMemory(channelId, 'assistant', reply);

        return reply;

    } catch (e) {
        console.error('Fetch error calling Gemini:', e?.message);
        return "⚠️ I couldn't reach my brain right now! Check the network and try again.";
    }
}

// ═══════════════════════════════════════════
// ♦️  SLASH COMMANDS
// ═══════════════════════════════════════════
const slashCommands = [
    // /say — staff & owner speak through the bot
    new SlashCommandBuilder()
        .setName('say')
        .setDescription('💬 Make Aria say something (staff only)')
        .addStringOption(o =>
            o.setName('message')
             .setDescription('What should Aria say?')
             .setRequired(true)
        ),

    // /addstaff — owner grants staff access
    new SlashCommandBuilder()
        .setName('addstaff')
        .setDescription('👮 Grant a user staff access to /say (owner only)')
        .addUserOption(o =>
            o.setName('user')
             .setDescription('User to add as staff')
             .setRequired(true)
        ),

    // /removestaff — owner revokes staff access
    new SlashCommandBuilder()
        .setName('removestaff')
        .setDescription('🚫 Remove a user\'s staff access (owner only)')
        .addUserOption(o =>
            o.setName('user')
             .setDescription('User to remove from staff')
             .setRequired(true)
        ),

    // /liststaffs — see who's on staff
    new SlashCommandBuilder()
        .setName('liststaffs')
        .setDescription('📋 List all staff members'),

    // /clearmemory — owner wipes a channel's conversation memory
    new SlashCommandBuilder()
        .setName('clearmemory')
        .setDescription('🧹 Clear Aria\'s conversation memory for this channel (owner only)'),

    // /ping — basic health check
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('🏓 Check if Aria is online'),

    // /about — info about this bot
    new SlashCommandBuilder()
        .setName('about')
        .setDescription('🌸 Learn about Aria'),
];

// ═══════════════════════════════════════════
// ♦️  CLIENT
// ═══════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// ═══════════════════════════════════════════
// ♦️  READY
// ═══════════════════════════════════════════
client.once('ready', async () => {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  🌸 Aria — AI Companion Bot              ║');
    console.log('║  Ping or reply to me and I\'ll respond!  ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`✅ Online as ${client.user?.tag}`);

    // Register slash commands globally
    try {
        const rest   = new REST({ version: '10' }).setToken(process.env.TOKEN);
        const body   = slashCommands.map(c => c.toJSON());
        await rest.put(Routes.applicationCommands(client.user.id), { body });
        console.log(`✅ Registered ${body.length} slash commands.`);
    } catch (e) {
        console.error('❌ Command registration error:', e?.message);
    }
});

// ═══════════════════════════════════════════
// ♦️  SLASH COMMAND HANDLER
// ═══════════════════════════════════════════
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const userId  = String(interaction.user.id);
    const guildId = String(interaction.guildId || '');
    const isOwner = userId === OWNER_ID;

    // Staff check: owner OR added via /addstaff OR has Discord Moderate Members perm
    const isStaff = isOwner
        || staffSet.has(`${guildId}:${userId}`)
        || staffSet.has(userId)
        || !!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);

    const cmd = interaction.commandName;

    // ── /ping ──
    if (cmd === 'ping') {
        return interaction.reply({
            content: `🏓 Pong! **${client.ws.ping}ms** — I'm alive and thinking! 🌸`,
            ephemeral: true,
        });
    }

    // ── /about ──
    if (cmd === 'about') {
        const embed = new EmbedBuilder()
            .setColor(0xFF69B4)
            .setTitle('🌸 Hi, I\'m Aria!')
            .setDescription(
                'I\'m an AI companion bot here to chat, answer questions, and help you with anything you need!\n\n' +
                '**How to talk to me:**\n' +
                '> • **Ping me** — `@Aria your question here`\n' +
                '> • **Reply to one of my messages** — I\'ll keep the conversation going\n\n' +
                'I remember our conversation in each channel so I can give you better answers over time! 🧠✨'
            )
            .addFields(
                { name: '🤖 Powered by', value: 'Google Gemini',    inline: true },
                { name: '💬 Commands',   value: '`/say` `/addstaff`',   inline: true },
                { name: '🌸 Personality', value: 'Friendly & helpful',  inline: true },
            )
            .setFooter({ text: 'Just ping or reply to start chatting!' })
            .setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    // ── /say ──
    if (cmd === 'say') {
        if (!isStaff) {
            return interaction.reply({ content: '❌ Only staff members can use `/say`!', ephemeral: true });
        }
        const msg = interaction.options.getString('message');
        await interaction.reply({ content: '✅ Sent!', ephemeral: true });
        return interaction.channel.send(msg).catch(() => {});
    }

    // ── /addstaff ──
    if (cmd === 'addstaff') {
        if (!isOwner) {
            return interaction.reply({ content: '❌ Only the owner can add staff!', ephemeral: true });
        }
        const target = interaction.options.getUser('user');
        if (!target || target.bot) {
            return interaction.reply({ content: '❌ Invalid user!', ephemeral: true });
        }
        const key = `${guildId}:${target.id}`;
        if (staffSet.has(key)) {
            return interaction.reply({ content: `ℹ️ **${target.username}** is already staff!`, ephemeral: true });
        }
        staffSet.add(key);
        await saveData();
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('👮 Staff Added')
                .setDescription(`**${target.username}** is now a staff member and can use \`/say\`! 🌸`)
                .setThumbnail(target.displayAvatarURL())
                .setTimestamp()
            ],
        });
    }

    // ── /removestaff ──
    if (cmd === 'removestaff') {
        if (!isOwner) {
            return interaction.reply({ content: '❌ Only the owner can remove staff!', ephemeral: true });
        }
        const target = interaction.options.getUser('user');
        if (!target) {
            return interaction.reply({ content: '❌ Invalid user!', ephemeral: true });
        }
        const key = `${guildId}:${target.id}`;
        if (!staffSet.has(key) && !staffSet.has(String(target.id))) {
            return interaction.reply({ content: `ℹ️ **${target.username}** isn't on the staff list.`, ephemeral: true });
        }
        staffSet.delete(key);
        staffSet.delete(String(target.id));
        await saveData();
        return interaction.reply({
            content: `✅ Removed **${target.username}** from staff.`,
            ephemeral: true,
        });
    }

    // ── /liststaffs ──
    if (cmd === 'liststaffs') {
        const serverStaff = [...staffSet].filter(k => k.startsWith(`${guildId}:`));
        if (serverStaff.length === 0) {
            return interaction.reply({ content: '📋 No staff members have been added yet!', ephemeral: true });
        }
        const lines = await Promise.all(serverStaff.map(async k => {
            const uid = k.split(':')[1];
            const u   = await client.users.fetch(uid).catch(() => null);
            return `• **${u?.username || 'Unknown'}** (` + "`" + `${uid}` + "`" + `)`;
        }));
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('👮 Staff List')
                .setDescription(lines.join('\n'))
                .setFooter({ text: `${serverStaff.length} staff member(s)` })
                .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── /clearmemory ──
    if (cmd === 'clearmemory') {
        if (!isOwner) {
            return interaction.reply({ content: '❌ Only the owner can clear my memory!', ephemeral: true });
        }
        channelMemory.delete(interaction.channelId);
        return interaction.reply({
            content: '🧹 Done! I\'ve forgotten this channel\'s conversation history. Fresh start! 🌸',
            ephemeral: true,
        });
    }
});

// ═══════════════════════════════════════════
// ♦️  MESSAGE HANDLER — AI RESPONSES
// ═══════════════════════════════════════════
client.on('messageCreate', async message => {
    // Ignore bots (including self)
    if (message.author.bot) return;

    const isMentioned = message.mentions.has(client.user);
    const isReply     = message.reference?.messageId != null;

    let shouldRespond = false;

    if (isMentioned) {
        // Directly pinged
        shouldRespond = true;
    } else if (isReply) {
        // Someone replied — check if the original message was from this bot
        try {
            const original = await message.channel.messages
                .fetch(message.reference.messageId)
                .catch(() => null);
            if (original && original.author.id === client.user.id) {
                shouldRespond = true;
            }
        } catch { /* ignore */ }
    }

    if (!shouldRespond) return;

    // Strip the bot mention from the message to get clean input
    let userText = message.content
        .replace(/<@!?[\d]+>/g, '')  // remove all mentions
        .trim();

    if (!userText) {
        userText = 'Hey! 👋';
    }

    // Show typing indicator while thinking
    await message.channel.sendTyping().catch(() => {});

    const reply = await askAI(
        message.channelId,
        userText,
        message.author.username,
    );

    // Every 2nd reply, append the love note 💕
    const count = (replyCounter.get(message.channelId) || 0) + 1;
    replyCounter.set(message.channelId, count);
    const finalReply = count % 2 === 0
        ? reply + '\n\n💕 *I Love Epic_Noob* 💕'
        : reply;

    // Discord has a 2000-char limit — split long replies if needed
    if (finalReply.length <= 2000) {
        await message.reply(finalReply).catch(async () => {
            await message.channel.send(finalReply).catch(() => {});
        });
    } else {
        const chunks = [];
        let remaining = finalReply;
        while (remaining.length > 0) {
            chunks.push(remaining.slice(0, 1990));
            remaining = remaining.slice(1990);
        }
        for (const chunk of chunks) {
            await message.channel.send(chunk).catch(() => {});
        }
    }
});

// ═══════════════════════════════════════════
// ♦️  ERROR HANDLING
// ═══════════════════════════════════════════
process.on('unhandledRejection', err => console.error('⚠️ Unhandled:', err?.message || err));
process.on('uncaughtException',  err => console.error('⚠️ Uncaught:',  err?.message || err));
client.on('error', err => console.error('⚠️ Client error:', err?.message));

// ═══════════════════════════════════════════
// ♦️  GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════
async function shutdown(sig) {
    console.log(`\n🔴 ${sig} — shutting down...`);
    await saveData();
    client.destroy();
    process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ═══════════════════════════════════════════
// ♦️  BOOT
// ═══════════════════════════════════════════
if (!process.env.TOKEN) {
    console.error('❌ TOKEN environment variable is not set!');
    process.exit(1);
}

(async () => {
    await loadData();
    await client.login(process.env.TOKEN).catch(err => {
        console.error('❌ Login failed:', err?.message);
        process.exit(1);
    });
})();
