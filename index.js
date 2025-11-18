import { WebSocket, WebSocketServer } from "ws";
import { spawn } from "child_process";
import dotenv from "dotenv";
import url from "url";

// Load environment variables
dotenv.config();


// Variables
const port = global.process.env.PORT || 8789;
const secretKey = global.process.env.SECRET_KEY || "HomeAssistant";
const pppwnCMD = global.process.env.PPPWN_CMD;
const pppwnProcessCMD = pppwnCMD ? pppwnCMD.trim().split(" ") : ["./pppwn", "-i", "eth0"];
let process = null;


// Create WebSocket server
const wss = new WebSocketServer({ port });


// Functions 
function broadcast(json) {
    try {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(json));
            }
        });
    } catch (error) {
        console.error("Broadcast error:", error);
    }
}

function killPPPwn() {
    if (process) {
        process.kill("SIGKILL");
        process = null;
    }
    broadcast({ type: "STATUS", message: "stopped" });
}

function startPPPwn() {
    if (process) {
        broadcast({ type: "STATUS", message: "started" });
        return;
    }

    process = spawn(pppwnProcessCMD[0], pppwnProcessCMD.slice(1));

    process.stdout.on("data", (data) => {
        broadcast({ type: "LOG", message: data.toString().trim() });
    });

    process.stderr.on("data", (data) => {
        broadcast({ type: "ERROR", message: data.toString().trim() });
    });

    process.on("close", (code) => {
        broadcast({ type: "STATUS", message: "stopped" });
        process = null;
    });

    process.on("error", (error) => {
        broadcast({ type: "ERROR", message: "error" });
        process = null;
    });

    broadcast({ type: "STATUS", message: "started" });
}
//


// WebSocket server events
console.log(`WebSocket server started on ws://localhost:${port}`);
if (!secretKey) console.log("WARNING: SECRET_KEY is not set. The server is running without authentication.");

wss.on("connection", (ws, req) => {
    if (secretKey) {
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        const secretParam = parsedUrl.searchParams.get("secret");

        if (secretParam !== secretKey) {
            ws.send(JSON.stringify({ type: "ERROR", message: "Unauthorized" }));
            ws.close();
            return;
        }
    }

    console.log(`New client connected from ${req.socket.remoteAddress}`);
    ws.send(JSON.stringify({ type: "STATUS", message: process ? "started" : "stopped" }));

    ws.on("message", (msg) => {
        const message = msg.toString();

        if (message === "start") {
            startPPPwn();
        } else if (message === "stop" || message === "kill") {
            killPPPwn();
        }
        else if (message === "status") {
            broadcast({ type: "STATUS", message: process ? "started" : "stopped" });
        }
    });

    ws.on("close", () => {
        console.log(`Client from ${req.socket.remoteAddress} disconnected`);
    });
});
