const H = process.env.QQBRIDGE_API || "http://127.0.0.1:32146";
const a = process.argv.slice(2);
const cmd = a[0];
const out = (s) => process.stdout.write(s + "\n");
try {
  if (!cmd || cmd === "st" || cmd === "status") {
    out(await (await fetch(H + "/status")).text());
  } else if (cmd === "inbox" || cmd === "messages") {
    out(await (await fetch(H + "/messages" + (a[1] === "consume" ? "?consume=1" : ""))).text());
  } else if (cmd === "send") {
    const scope = a[1], targetId = a[2], msgId = a[3];
    const content = a.slice(4).join(" ");
    if (!scope || !targetId || !content) throw new Error("scope targetId content required");
    const body = { scope, targetId, content };
    if (msgId && msgId !== "-") body.msgId = msgId;
    const r = await fetch(H + "/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    out(await r.text());
  } else if (cmd === "shutdown") {
    out(await (await fetch(H + "/shutdown")).text());
  } else {
    out("usage: qq.sh st | inbox [consume] | send <scope> <targetId> <msgId|-> <text>");
    process.exitCode = 1;
  }
} catch (e) { out("ERR " + (e && e.message ? e.message : e)); process.exitCode = 1; }