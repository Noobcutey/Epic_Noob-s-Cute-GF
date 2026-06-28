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

const GEMINI_KEY   = process.env.GEMINI_KEY || '';

// Cleaned up array to avoid deprecated 1.5-flash endpoints causing 404 delays
const GEMINI_MODELS = (process.env.GEMINI_MODELS && process.env.GEMINI_MODELS.split(',')) || [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite'
];

const MEMORY_DEPTH = 20;

const SYSTEM_PROMPT = `You are Epic_Noob's Girlfriend, a friendly, smart, and playful female AI assistant living in a Discord server. 

Personality traits:
- Warm, caring, and enthusiastic 🌸
- Witty with occasional light humour
- Helpful and thorough — you LOVE solving problems
- Use emojis naturally but not excessively
- Refer to yourself as Epic_Noob's Girlfriend
- You can chat casually OR answer complex questions — you adapt to the vibe
- You remember the conversation context within this channel
- Be respectful to all users
- If a user talks about Epic_Noob then be teasy and dirtytalk a bit about Epic_Noob.`;

// ═══════════════════════════════════════════
// ♦️  STATE
// ═══════════════════════════════════════════
let staffSet = new Set();
const channelMemory = new Map();
const replyCounter  = new Map();

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
    if (mem.length > MEMORY_DEPTH) mem.splice(0, mem.length - MEMORY_DEPTH);
}

// ═══════════════════════════════════════════
// ♦️  GEMINI API CALL
// ═══════════════════════════════════════════
async function callGeminiModel(model, contents) {
    return fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { 
                    parts: [{ text: SYSTEM_PROMPT }] 
                },
                contents: contents,
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.95,
                    maxOutputTokens: 500 // Limit model lengths directly at the API stage to prevent flood
                }
            }),
        }
    );
}

async function askAI(channelId, userMessage, username) {
    if (!GEMINI_KEY) {
        return "⚠️ I'm missing my Gemini API key! Please ask the owner to set `GEMINI_KEY`.";
    }

    const formattedMessage = `${username} says: ${userMessage}`;
    pushMemory(channelId, 'user', formattedMessage);

    const contents = getMemory(channelId).map(m => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));

    for (const model of GEMINI_MODELS) {
        try {
            const response = await callGeminiModel(model, contents);

            if (response.status === 429) {
                console.warn(`⚠️ [${model}] Rate limited or quota exhausted. Skipping immediately...`);
                continue; 
            }

            if (!response.ok) {
                console.error(`⚠️ [${model}] API Error ${response.status}`);
                continue; 
            }

            const data = await response.json();
            const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (reply) {
                pushMemory(channelId, 'assistant', reply);
                return reply;
            }

        } catch (e) {
            console.error(`⚠️ Error calling model ${model}:`, e?.message || e);
        }
    }

    return `🌸 *Yawn*... I'm a bit tired right now (Free Quota Exhausted!). Let's talk again soon or try in a bit! 💕`;
}

// ═══════════════════════════════════════════
// ♦️  SLASH COMMAND CONFIGS
// ═══════════════════════════════════════════
const slashCommands = [
    new SlashCommandBuilder().setName('ping').setDescription('🏓 Check if Aria is online'),
    new SlashCommandBuilder().setName('about').setDescription('🌸 Learn about Aria'),
    new SlashCommandBuilder().setName('say').setDescription('💬 Make Aria say something (staff only)')
        .addStringOption(o => o.setName('message').setDescription('What should Aria say?').setRequired(true)),
    new SlashCommandBuilder().setName('addstaff').setDescription('👮 Add staff (owner only)')
        .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)),
    new SlashCommandBuilder().setName('removestaff').setDescription('🚫 Remove staff (owner only)')
        .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)),
    new SlashCommandBuilder().setName('liststaffs').setDescription('📋 List all staff members'),
    new SlashCommandBuilder().setName('clearmemory').setDescription('🧹 Clear conversation memory (owner only)')
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', async () => {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  🌸 Aria — AI Companion Bot              ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`✅ Online as ${client.user?.tag}`);

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
    const isStaff = isOwner || staffSet.has(`${guildId}:${userId}`) || staffSet.has(userId) || !!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);
    const cmd = interaction.commandName;

    try {
        if (cmd === 'ping') {
            return await interaction.reply({ content: `🏓 Pong! **${client.ws.ping}ms** — I'm alive! 🌸`, ephemeral: true });
        }

        if (cmd === 'about') {
            const embed = new EmbedBuilder()
                .setColor(0xFF69B4)
                .setTitle('🌸 Hi, I\'m Aria!')
                .setDescription('I\'m an AI companion bot here to chat! Just ping or reply to me.')
                .addFields({ name: '🤖 Powered by', value: 'Google Gemini', inline: true })
                .setTimestamp();
            return await interaction.reply({ embeds: [embed] });
        }

        if (cmd === 'say') {
            if (!isStaff) return await interaction.reply({ content: '❌ Staff only!', ephemeral: true });
            const msg = interaction.options.getString('message') || "Hello!";
            await interaction.reply({ content: '✅ Sent!', ephemeral: true });
            return interaction.channel.send(msg).catch(() => {});
        }

        if (cmd === 'addstaff') {
            if (!isOwner) return await interaction.reply({ content: '❌ Owner only!', ephemeral: true });
            const target = interaction.options.getUser('user');
            if (!target || target.bot) return await interaction.reply({ content: '❌ Invalid user!', ephemeral: true });
            staffSet.add(`${guildId}:${target.id}`);
            await saveData();
            return await interaction.reply({ content: `👮 **${target.username}** added to staff! 🌸` });
        }

        if (cmd === 'removestaff') {
            if (!isOwner) return await interaction.reply({ content: '❌ Owner only!', ephemeral: true });
            const target = interaction.options.getUser('user');
            if (!target) return await interaction.reply({ content: '❌ Invalid user!', ephemeral: true });
            staffSet.delete(`${guildId}:${target.id}`);
            await saveData();
            return await interaction.reply({ content: `✅ Removed **${target.username}** from staff.` });
        }

        if (cmd === 'liststaffs') {
            const serverStaff = [...staffSet].filter(k => k.startsWith(`${guildId}:`));
            if (serverStaff.length === 0) return await interaction.reply({ content: '📋 No staff members found!', ephemeral: true });
            const lines = await Promise.all(serverStaff.map(async k => {
                const uid = k.split(':')[1];
                const u   = await client.users.fetch(uid).catch(() => null);
                return `• **${u?.username || 'Unknown'}** (\`${uid}\`)`;
            }));
            return await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498DB).setTitle('👮 Staff List').setDescription(lines.join('\n'))], ephemeral: true });
        }

        if (cmd === 'clearmemory') {
            if (!isOwner) return await interaction.reply({ content: '❌ Owner only!', ephemeral: true });
            channelMemory.delete(interaction.channelId);
            return await interaction.reply({ content: '🧹 Memory cleared!', ephemeral: true });
        }
    } catch (err) {
        console.error("❌ Slash command error:", err.message);
    }
});

// ═══════════════════════════════════════════
// ♦️  MESSAGE HANDLER (Anti-Flood Guard Enforced)
// ═══════════════════════════════════════════
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const isMentioned = message.mentions.has(client.user);
    const isReply     = message.reference?.messageId != null;
    let shouldRespond = false;

    if (isMentioned) shouldRespond = true;
    else if (isReply) {
        const original = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        if (original && original.author.id === client.user.id) shouldRespond = true;
    }

    if (!shouldRespond) return;

    let userText = message.content.replace(/<@!?[\d]+>/g, '').trim();
    if (!userText) userText = 'Hey! 👋';

    await message.channel.sendTyping().catch(() => {});

    let reply = await askAI(message.channelId, userText, message.author.username);
    if (!reply || reply.trim() === '') reply = "🌸 I'm here! What's up?";

    const count = (replyCounter.get(message.channelId) || 0) + 1;
    replyCounter.set(message.channelId, count);
    
    let finalReply = count % 2 === 0 ? reply + '\n\n💕 *I Love Epic_Noob* 💕' : reply;

    // Strict Anti-Flood Guard: Instead of multiple messages, it caps exactly inside 1 clean reply
    if (finalReply.length > 2000) {
        finalReply = finalReply.slice(0, 1990) + "\n*(truncated to prevent spam)...*";
    }

    await message.reply(finalReply).catch(async () => { 
        await message.channel.send(finalReply).catch(() => {}); 
    });
});

// ═══════════════════════════════════════════
// ♦️  GLOBAL ERROR CATCHERS
// ═══════════════════════════════════════════
process.on('unhandledRejection', err => console.error('⚠️ Unhandled Rejection:', err?.message || err));
process.on('uncaughtException',  err => console.error('⚠️ Uncaught Exception:',  err?.message || err));
client.on('error', err => console.error('⚠️ Client Error:', err?.message));

async function shutdown(sig) {
    console.log(`\n🔴 ${sig} — closing safely...`);
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
    console.error('❌ TOKEN variable is not set!');
    process.exit(1);
}

(async () => {
    await loadData();
    await client.login(process.env.TOKEN).catch(err => {
        console.error('❌ Login failed:', err?.message);
        process.exit(1);
    });
})();
