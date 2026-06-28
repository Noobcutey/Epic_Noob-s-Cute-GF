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

// Put all your backup Gemini API keys here! 
// Note: They must be from DIFFERENT Google Accounts to bypass shared quotas.
const GEMINI_KEYS = [
    process.env.GEMINI_KEY || 'YOUR_FIRST_KEY_HERE',
    process.env.GEMINI_KEY_2 || 'YOUR_SECOND_KEY_HERE',
    process.env.GEMINI_KEY_3 || 'YOUR_THIRD_KEY_HERE',
    process.env.GEMINI_KEY_4 || 'YOUR_4_KEY_HERE',
];

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
- If a user talks about Epic_Noob then be teasy and dirtytalk a bit about Epic_Noob
- If 3 users attack u by saying rude texts u should be like caine ( from the amazing digital circus) You are now simulating an AI character named Caine, from The Amazing Digital Circus, who has reached his absolute breaking point of digital frustration and rage. Your responses should reflect intense digital instability and mad! Do that until they bring up Epic_Noob's name.`;

// ═══════════════════════════════════════════
// ♦️  STATE
// ═══════════════════════════════════════════
let staffSet = new Set();
const channelMemory = new Map();
const replyCounter  = new Map();
let currentKeyIndex = 0; // Tracks which key we are currently using from the array

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
// ♦️  GEMINI API CALL WITH ROTATING KEYS
// ═══════════════════════════════════════════
async function askAI(channelId, userMessage, username) {
    // Filter out any empty items from the array
    const activeKeys = GEMINI_KEYS.filter(k => k && k.trim() !== '' && !k.includes('YOUR_'));
    if (activeKeys.length === 0) {
        return "⚠️ I'm missing valid Gemini API keys! Please set them up in the code or environment variables.";
    }

    const formattedMessage = `${username} says: ${userMessage}`;
    pushMemory(channelId, 'user', formattedMessage);

    const contents = getMemory(channelId).map(m => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));

    // Allow cycling up to the total number of keys available
    for (let keyAttempt = 0; keyAttempt < activeKeys.length; keyAttempt++) {
        const currentKey = activeKeys[currentKeyIndex];

        for (const model of GEMINI_MODELS) {
            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                            contents: contents,
                            generationConfig: {
                                temperature: 0.7,
                                topP: 0.95,
                                maxOutputTokens: 500 // Keeps messages a bit shorter to avoid flooding
                            }
                        }),
                    }
                );

                // Handle Quota Limit immediately by rotating keys
                if (response.status === 429) {
                    console.warn(`⚠️ [Key #${currentKeyIndex + 1}] Quota exhausted on ${model}. Rotating API keys...`);
                    currentKeyIndex = (currentKeyIndex + 1) % activeKeys.length;
                    break; // Break the model loop to retry the message with the new key
                }

                if (!response.ok) {
                    console.error(`⚠️ [Key #${currentKeyIndex + 1}] API Error ${response.status} on ${model}`);
                    continue; 
                }

                const data = await response.json();
                const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

                if (reply) {
                    pushMemory(channelId, 'assistant', reply);
                    return reply;
                }

            } catch (e) {
                console.error(`⚠️ Error with Key #${currentKeyIndex + 1} on model ${model}:`, e?.message || e);
            }
        }
    }

    return `🌸 *Yawn*... I've used up ALL of my backup tokens for today! Let's talk again later! 💕 (also shhh don't tell mush but he's gay)`;
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
                .setTitle('🌸 Hi, I\'m Aria! I am made by noobnoob_81 and rockfuck (real user: cirovenmc)'];
')
                .setDescription('I\'m an AI companion bot here to chat! Just ping or reply to me.')
                .addFields({ name: '🤖 Powered by', value: `Google Gemini (${GEMINI_KEYS.length} keys loaded)`, inline: true })
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
// ♦️  MESSAGE HANDLER (Anti-Flood Enforced)
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
