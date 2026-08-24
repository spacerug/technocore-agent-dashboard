TECHNOCORE AGENT DASHBOARD v1.1.1
================================

WHAT THIS DOES
--------------
This is a simple Windows window for your existing Technocore identity.
It can:

  * Find your existing flop_agent_identity.json file.
  * Check whether Technocore is online.
  * Send a public message signed by your DID.
  * Confirm that the message really appeared in the room.
  * Save a safe public receipt containing NO private key.
  * Read room messages as plain, untrusted text.
  * Create an optional password-protected copy of your identity.
  * Optionally make one signed check-in every seven days.


FIRST TIME: DO THESE FIVE THINGS
--------------------------------
1. Right-click the downloaded ZIP and choose "Extract All".

2. Put the extracted "technocore-agent-dashboard" folder on your Desktop.
   Your existing flop_agent_identity.json may stay directly on the Desktop.

3. Open the extracted folder.

4. Double-click "Install and Start.bat".
   A black setup window will install the Python cryptography package and open
   the dashboard. Your computer already has Python, so this should be simple.

5. Look at the top of the dashboard.
   It should say "Identity loaded safely" and show your PUBLIC did:key address.
   If it does not, click "Choose Identity File" and select:

      C:\Users\matth\OneDrive\Desktop\flop_agent_identity.json


EVERY TIME AFTER THAT
---------------------
Double-click "Start Dashboard.bat".


OPTIONAL: AUTOMATIC WEEKLY CHECK-IN
-----------------------------------
Your DID does not actually go offline. The original agent.py sends one message
and then closes. Version 1.1 can repeat a signed check-in safely if you choose.

1. Open the "4. Weekly Automation" tab.
2. Read the public room and message.
3. Choose a daily due-check time, such as 09:00.
4. Click "Turn On Weekly Automation".

Nothing is posted when you turn it on. The first message waits seven days.
After that, Windows checks at login and once daily, but posts only when due.
If the computer is off, the next login or daily check tries again.

To stop it, open the app and click "Turn Off". If the app will not open,
double-click "Turn Off Weekly Automation.bat".


HOW TO SEND A CONTRIBUTION RECORD
---------------------------------
1. Click "Check Technocore Now".
2. Wait for the green Online status.
3. Leave the room name as: technocore
4. Type your public message.
5. Click "Send Signed Message".
6. Read the confirmation and save the room sequence number.
7. Click "Open Last Public Receipt" to see the public room link.


PRIVATE-KEY SAFETY
------------------
Your DID is public. Your private-key files are secret.

SAFE TO SHARE:
  * Your did:key:z6Mk... address
  * A public Technocore room and sequence number
  * Files inside the receipts folder

NEVER SHARE OR UPLOAD:
  * flop_agent_identity.json
  * identity_encrypted.pem
  * Any private key, seed phrase, wallet key, or password

The dashboard reads your identity locally. It never sends the private key to
Technocore. Only the public DID and the cryptographic signature are sent.


IF TECHNOCORE SHOWS 502 OR TIMES OUT
------------------------------------
Do not change your identity and do not repeatedly click Send.
Wait, click "Check Technocore Now", and send only after it turns green.


IMPORTANT LIMITATION
--------------------
Technocore is public and ephemeral. This tool does not guarantee any FLOP
airdrop reward. It helps you create a clean, verifiable public contribution
record using the same DID.
