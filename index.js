import { WebSocket, WebSocketServer } from "ws";
import { spawn } from "child_process";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();


// Variables
const port = global.process.env.PORT || 8789;
const secretKey = global.process.env.SECRET_KEY || "HomeAssistant";
const pppwnCMD = global.process.env.PPPWN_CMD;
const pppwnProcessCMD = pppwnCMD ? pppwnCMD.split(" ") : ["./pppwn", "-i", "eth0"];
let process = null;


// Create WebSocket server
const wss = new WebSocketServer({ port });


// Functions 
function broadcast(message) {
    try {
        wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
    } catch (error) {
        console.error("Broadcast error:", error);
    }
}

function killPPPwn() {
    if (process) {
        process?.kill("SIGTERM");
        process = null;

        return "stopped";
    }
    return "already stopped";
}

function startPPPwn() {
    if(process) {
        return "already started";
    }

    process = spawn(pppwnProcessCMD[0], pppwnProcessCMD.slice(1));

    process.stdout.on("data", (data) => {
        broadcast("LOG: " + data.toString().trim());
    });
    
    process.stderr.on("data", (data) => {
        broadcast("ERROR:" + data.toString().trim());
    });

    process.on("close", (code) => {
        broadcast("STATUS: stopped");
        process = null;
    });

    return "started";
}

//



// WebSocket server events
console.log(`WebSocket server started on ws://localhost:${port}`);
if (!secretKey) console.log("WARNING: SECRET_KEY is not set. The server is running without authentication.");

wss.on("connection", (ws, req) => {
    if(secretKey) {
        if (req.headers["x-secret"] !== secretKey) {
            ws.send("ERROR: Unauthorized");
            ws.close();
            return;
        }
    }

    console.log(`New client connected from ${req.socket.remoteAddress}`);

    
    ws.on("message", (msg) => {
        const message = msg.toString();


        if (message === "start") {
            const result = startPPPwn();
            ws.send("STATUS: " + result);
        } else if (message === "stop") {
            const result = killPPPwn();
            ws.send("STATUS: " + result);
        }
    });


});
