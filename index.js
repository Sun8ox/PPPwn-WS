import { WebSocket, WebSocketServer } from "ws";
import { spawn } from "child_process";
import dotenv from "dotenv";
import url from "url";

// Load environment variables
dotenv.config();


// Variables
const port = global.process.env.PORT || 8789;
const secretKey = global.process.env.SECRET_KEY || "SecretKey";
const pppwnCMD = global.process.env.PPPWN_CMD;
const pppwnProcessCMD = pppwnCMD ? pppwnCMD.trim().split(" ") : ["./pppwn", "-i", "eth0"];
// Track PPPwn subprocess separately to avoid shadowing Node's global `process`
let pppwnProcess = null;


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
    if (!pppwnProcess) {
        broadcast({ type: "STATUS", message: "stopped" });
        return;
    }

    try {
        // Attempt to terminate the entire process group created by detached spawn
        const pid = pppwnProcess.pid;
        if (pid && pid > 0) {
            try {
                // First try graceful stop
                global.process.kill(-pid, "SIGTERM");
            } catch (e) {
                // Fallback: kill the child directly
                try { global.process.kill(pid, "SIGTERM"); } catch {}
            }

            // Give it a short window to exit, then force kill
            setTimeout(() => {
                try {
                    global.process.kill(-pid, "SIGKILL");
                } catch (e) {
                    try { global.process.kill(pid, "SIGKILL"); } catch {}
                }
            }, 250);
        }

        // Clean up listeners and state
        try { pppwnProcess.stdout?.removeAllListeners?.("data"); } catch {}
        try { pppwnProcess.stderr?.removeAllListeners?.("data"); } catch {}
        try { pppwnProcess.removeAllListeners?.("close"); } catch {}
        try { pppwnProcess.removeAllListeners?.("error"); } catch {}
    } finally {
        pppwnProcess = null;
        broadcast({ type: "STATUS", message: "stopped" });
    }
}

function startPPPwn() {
    if (pppwnProcess) {
        broadcast({ type: "STATUS", message: "started" });
        return;
    }

    // Spawn detached so the child has its own process group; use pipes for logs
    pppwnProcess = spawn(pppwnProcessCMD[0], pppwnProcessCMD.slice(1), {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: global.process.env,
    });

    // Prevent child from keeping the event loop alive unnecessarily
    try { pppwnProcess.unref(); } catch {}

    pppwnProcess.stdout.on("data", (data) => {
        broadcast({ type: "LOG", message: data.toString().trim() });
    });

    pppwnProcess.stderr.on("data", (data) => {
        broadcast({ type: "ERROR", message: data.toString().trim() });
    });

    pppwnProcess.on("close", () => {
        broadcast({ type: "STATUS", message: "stopped" });
        pppwnProcess = null;
    });

    pppwnProcess.on("error", (err) => {
        broadcast({ type: "ERROR", message: `error: ${err?.message || "unknown"}` });
        pppwnProcess = null;
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
    ws.send(JSON.stringify({ type: "STATUS", message: pppwnProcess ? "started" : "stopped" }));

    ws.on("message", (msg) => {
        const message = msg.toString();

        if (message === "start") {
            startPPPwn();
        } else if (message === "stop" || message === "kill") {
            killPPPwn();
        }
        else if (message === "status") {
            broadcast({ type: "STATUS", message: pppwnProcess ? "started" : "stopped" });
        }
    });

    ws.on("close", () => {
        console.log(`Client from ${req.socket.remoteAddress} disconnected`);
    });
});

// Graceful shutdown of server and child
for (const sig of ["SIGINT", "SIGTERM"]) {
    global.process.on(sig, () => {
        try { killPPPwn(); } catch {}
        try { wss.close(); } catch {}
        // Slight delay to allow broadcasts
        setTimeout(() => global.process.exit(0), 200);
    });
}
