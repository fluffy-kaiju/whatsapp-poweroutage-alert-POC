import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from 'baileys'
import QRCode from 'qrcode'
import P from 'pino'
import readline from 'readline' // Import the readline module
import express from 'express'   // Import express for the HTTP server

// --- Express Server Setup ---
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Global variables to hold the WhatsApp socket and selected group ID
let globalSock = null;
let globalSelectedGroupId = null;

// POST endpoint to send a message
app.post('/send-message', async (req, res) => {
    const { message } = req.body;

    if (!globalSock || !globalSelectedGroupId) {
        return res.status(500).json({ error: 'WhatsApp is not connected or a group has not been selected yet.' });
    }

    if (!message) {
        return res.status(400).json({ error: 'Message text is required in the request body ({"message": "Hello"}).' });
    }

    try {
        await sendGroupMessage(globalSock, globalSelectedGroupId, message);
        res.status(200).json({ success: true, message: 'Message sent successfully.' });
    } catch (error) {
        console.error('Error sending message via API:', error);
        res.status(500).json({ error: 'Failed to send message.' });
    }
});

// Start the HTTP server
app.listen(PORT, () => {
    console.log(`HTTP server listening on http://localhost:${PORT}`);
});
// ----------------------------

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

    const { version, isLatest } = await fetchLatestBaileysVersion()
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`)

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }),
    })

    // Store the socket instance globally so the Express route can access it
    globalSock = sock;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log(await QRCode.toString(qr, { type: 'terminal' }))
        }

        if (connection === 'close') {
            console.log('Connection closed, reconnecting...')
            connectToWhatsApp()
        } else if (connection === 'open') {
            console.log('Opened connection to WhatsApp!')

            // Call the interactive choose group function
            const selectedGroupId = await chooseGroup(sock);

            if (selectedGroupId) {
                console.log(`Successfully stored Group ID: ${selectedGroupId}`);
                // Store the group ID globally for the Express route to use
                globalSelectedGroupId = selectedGroupId;
                console.log(`\nYou can now send messages via POST to http://localhost:${PORT}/send-message`);
            } else {
                console.log('No group was selected.');
            }
        }
    })

    sock.ev.on('creds.update', saveCreds)
}

// Function to prompt the user to choose a group
async function chooseGroup(sock) {
    console.log('Fetching all groups...')
    try {
        const groups = await sock.groupFetchAllParticipating();
        const groupArray = Object.values(groups);

        if (groupArray.length === 0) {
            console.log('You are not participating in any groups.');
            return null;
        }

        console.log('\n--- Available Groups ---');
        groupArray.forEach((group, index) => {
            console.log(`${index + 1}. ${group.subject}`);
        });
        console.log('------------------------');

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('\nEnter the number of the group you want to select: ', (answer) => {
                const choice = parseInt(answer.trim(), 10);
                rl.close();

                if (!isNaN(choice) && choice > 0 && choice <= groupArray.length) {
                    const selectedGroup = groupArray[choice - 1];
                    console.log(`\nYou selected: ${selectedGroup.subject} (ID: ${selectedGroup.id})`);
                    resolve(selectedGroup.id);
                } else {
                    console.log('\nInvalid selection. Please run again and select a valid number.');
                    resolve(null);
                }
            });
        });
    } catch (error) {
        console.error('Failed to fetch groups for selection:', error);
        return null;
    }
}

// Function to fetch all groups the user is participating in
async function fetchAllGroups(sock) {
    try {
        const groups = await sock.groupFetchAllParticipating();
        const groupCount = Object.keys(groups).length;
        console.log(`Successfully fetched ${groupCount} groups.`);

        for (const jid in groups) {
            console.log(`- Group Name: ${groups[jid].subject}`);
            console.log(`  JID: ${jid}\n`);
        }

        return groups;
    } catch (error) {
        console.error('Failed to fetch groups:', error);
    }
}

// Function to send a message to a group
async function sendGroupMessage(sock, groupId, text) {
    try {
        const groupJid = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;
        const sentMsg = await sock.sendMessage(groupJid, { text });
        console.log(`Successfully sent message to ${groupJid}`);
        return sentMsg;
    } catch (error) {
        console.error('Failed to send group message:', error);
        throw error; // Throw so the API route catches it
    }
}

connectToWhatsApp()
