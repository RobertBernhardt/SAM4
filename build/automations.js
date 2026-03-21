function runDailyBriefing() {
    const uid = "auto_" + new Date().getTime();
    const instruction = "Analyze yesterday's logs and summarize the total token spend.";
    // call the engine directly
    const result = runAlgo("masteralgo", uid, instruction);
    // send the result to your master bot so you see it on your phone
    sendReply(getMasterBotToken(), getAdminChatId(), result);
}
