// Objective: Provide the legacy root Express endpoint retained for basic server verification.
const engineMain = (req , res) => {
    res.send('Hello World from Express!, Time and time again from engine');
}

module.exports = {
    engineMain
}
