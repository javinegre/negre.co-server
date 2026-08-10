module.exports = {
  apps: [
    {
      name: 'negre-co-server',
      script: 'server.ts',
      interpreter: 'tsx',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
      },
    },
  ],
};
