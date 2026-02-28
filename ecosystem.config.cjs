module.exports = {
  apps: [{
    name: "faucet",
    script: "dist/index.js",
    cwd: "/home/dev/faucet",
    env: {
      PORT: "3006",
      FAUCET_DB_PATH: "./data/faucet.db",
      CASINO_DB_PATH: "/home/dev/casino/data/casino.db",
    }
  }]
};
