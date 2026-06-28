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
GEMINI_MODELS=gemini-2.5-flash,gemini-2.0-flash,gemini-2.0-flash-lite,gemini-1.5-flash

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
// ♦️  GEMINI API CALL (Fixed Structure with Model Fallback)
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
                }
            }),
        }
    );
}

async function askAI(channelId, userMessage, username) {
    if (!GEMINI_KEY) {
        return "⚠️ I'm missing my Gemini API key! Please ask the owner to set `GEMINI_KEY` in the environment variables.";
    }

    const formattedMessage = `${username} says: ${userMessage}`;
    pushMemory(channelId, 'user', formattedMessage);

    const contents = getMemory(channelId).map(m => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));

    for (const model of GEMINI_MODELS) {
        const MAX_RATE_RETRIES = 1;

        for (let attempt = 0; attempt <= MAX_RATE_RETRIES; attempt++) {
            try {
                const response = await callGeminiModel(model, contents);

                if (response.status === 429) {
                    const errBody = await response.json().catch(() => ({}));
                    const quotaViolations = errBody?.error?.details
                        ?.find(d => d['@type']?.includes('QuotaFailure'))
                        ?.violations || [];

                    const isDaily = quotaViolations.some(v =>
                        (v.quotaId || '').toLowerCase().includes('perday')
                    );

                    if (isDaily) {
                        console.warn(`⚠️ [${model}] Daily quota exhausted, skipping to next model...`);
                        break;
                    }

                    const retryInfo = errBody?.error?.details?.find(d => d.retryDelay);
                    const delaySec  = Math.min(
                        retryInfo ? (parseInt(retryInfo.retryDelay, 10) || 10) : 10,
                        15
                    );

                    console.warn(`⚠️ [${model}] Rate limited (per-min). Waiting ${delaySec}s (attempt ${attempt + 1}/${MAX_RATE_RETRIES + 1})...`);

                    if (attempt < MAX_RATE_RETRIES) {
                        await new Promise(r => setTimeout(r, delaySec * 1000));
                        continue;
                    }
                    console.warn(`⚠️ [${model}] Still rate limited, trying next model...`);
                    break;
                }

                if (response.status === 400 || response.status === 404) {
                    const errBody = await response.json().catch(() => ({}));
                    console.warn(`⚠️ [${model}] Not available (${response.status}): ${errBody?.error?.message || ''}. Trying next model...`);
                    break;
                }

                if (!response.ok) {
                    const err = await response.text().catch(() => '');
                    console.error(`⚠️ [${model}] API error ${response.status}:`, err);
                    break;
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
    }

    return `⚠️ I couldn't get a response from Gemini right now. Please check your configurations or try again later.`;
}

// ═══════════════════════════════════════════
// ♦️  SLASH COMMAND CONFIGS
// ═══════════════════════════════════════════
const slashCommands = [
    new SlashCommandBuilder()
        .setName('say')
        .setDescription('💬 Make Aria say something (staff only)')
        .addStringOption(o => o.setName('message').setDescription('What should Aria say?').setRequired(true)),
    new SlashCommandBuilder()
        .setName('addstaff')
        .setDescription('👮 Grant a user staff access to /say (owner only)')
        .addUserOption(o => o.setName('user').setDescription('User to add as staff').setRequired(true)),
    new SlashCommandBuilder()
        .setName('removestaff')
        .setDescription('🚫 Remove a user\'s staff access (owner only)')
        .addUserOption(o => o.setName('user').setDescription('User to remove from staff').setRequired(true)),
    new SlashCommandBuilder()
        .setName('liststaffs')
        .setDescription('📋 List all staff members'),
    new SlashCommandBuilder()
        .setName('clearmemory')
        .setDescription('🧹 Clear Aria\'s conversation memory for this channel (owner only)'),
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('🏓 Check if Aria is online'),
    new SlashCommandBuilder()
        .setName('about')
        .setDescription('🌸 Learn about Aria'),
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
    console.log('║  Ping or reply to me and I\'ll respond!  ║');
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

    const isStaff = isOwner
        || staffSet.has(`${guildId}:${userId}`)
        || staffSet.has(userId)
        || !!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);

    const cmd = interaction.commandName;

    try {
        if (cmd === 'ping') {
            return await interaction.reply({
                content: `🏓 Pong! **${client.ws.ping}ms** — I'm alive and thinking! 🌸`,
                ephemeral: true,
            }).catch(() => {});
        }

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
            return await interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        if (cmd === 'say') {
            if (!isStaff) return await interaction.reply({ content: '❌ Only staff members can use `/say`!', ephemeral: true }).catch(() => {});
            const msg = interaction.options.getString('message') || "Hello!";
            await interaction.reply({ content: '✅ Sent!', ephemeral: true }).catch(() => {});
            return interaction.channel.send(msg).catch(() => {});
        }

        if (cmd === 'addstaff') {
            if (!isOwner) return await interaction.reply({ content: '❌ Only the owner can add staff!', ephemeral: true }).catch(() => {});
            const target = interaction.options.getUser('user');
            if (!target || target.bot) return await interaction.reply({ content: '❌ Invalid user!', ephemeral: true }).catch(() => {});
            
            const key = `${guildId}:${target.id}`;
            if (staffSet.has(key)) return await interaction.reply({ content: `ℹ️ **${target.username}** is already staff!`, ephemeral: true }).catch(() => {});
            
            staffSet.add(key);
            await saveData();
            return await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('👮 Staff Added')
                    .setDescription(`**${target.username}** is now a staff member and can use \`/say\`! 🌸`)
                    .setThumbnail(target.displayAvatarURL())
                    .setTimestamp()
                ],
            }).catch(() => {});
        }

        if (cmd === 'removestaff') {
            if (!isOwner) return await interaction.reply({ content: '❌ Only the owner can remove staff!', ephemeral: true }).catch(() => {});
            const target = interaction.options.getUser('user');
            if (!target) return await interaction.reply({ content: '❌ Invalid user!', ephemeral: true }).catch(() => {});
            
            const key = `${guildId}:${target.id}`;
            staffSet.delete(key);
            staffSet.delete(String(target.id));
            await saveData();
            return await interaction.reply({ content: `✅ Removed **${target.username}** from staff.`, ephemeral: true }).catch(() => {});
        }

        if (cmd === 'liststaffs') {
            const serverStaff = [...staffSet].filter(k => k.startsWith(`${guildId}:`));
            if (serverStaff.length === 0) return await interaction.reply({ content: '📋 No staff members found!', ephemeral: true }).catch(() => {});
            
            const lines = await Promise.all(serverStaff.map(async k => {
                const uid = k.split(':')[1];
                const u   = await client.users.fetch(uid).catch(() => null);
                return `• **${u?.username || 'Unknown'}** (\`${uid}\`)`;
            }));
            return await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('👮 Staff List')
                    .setDescription(lines.join('\n'))
                    .setFooter({ text: `${serverStaff.length} staff member(s)` })
                    .setTimestamp()
                ],
                ephemeral: true,
            }).catch(() => {});
        }

        if (cmd === 'clearmemory') {
            if (!isOwner) return await interaction.reply({ content: '❌ Only the owner can clear memory!', ephemeral: true }).catch(() => {});
            channelMemory.delete(interaction.channelId);
            return await interaction.reply({ content: '🧹 Done! I\'ve forgotten this channel\'s conversation history. Fresh start! 🌸', ephemeral: true }).catch(() => {});
        }
    } catch (err) {
        console.error("❌ Error handling slash command:", err.message);
    }
});

// ═══════════════════════════════════════════
// ♦️  MESSAGE HANDLER
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
    
    const finalReply = count % 2 === 0 ? reply + '\n\n💕 *I Love Epic_Noob* 💕' : reply;

    if (finalReply.length <= 2000) {
        await message.reply(finalReply).catch(async () => { 
            await message.channel.send(finalReply).catch(() => {}); 
        });
    } else {
        let remaining = finalReply;
        while (remaining.length > 0) {
            const chunk = remaining.slice(0, 1990);
            if (chunk.trim().length > 0) {
                await message.channel.send(chunk).catch(() => {});
            }
            remaining = remaining.slice(1990);
        }
    }
});

// ═══════════════════════════════════════════
// ♦️  GLOBAL ERROR CATCHERS
// ═══════════════════════════════════════════
process.on('unhandledRejection', err => console.error('⚠️ Caught Unhandled Rejection:', err?.message || err));
process.on('uncaughtException',  err => console.error('⚠️ Caught Uncaught Exception:',  err?.message || err));
client.on('error', err => console.error('⚠️ Discord Client Error:', err?.message));

async function shutdown(sig) {
    console.log(`\n🔴 ${sig} — shutting down safely...`);
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
