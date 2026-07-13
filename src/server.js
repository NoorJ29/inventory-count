const { app, ADMIN_PASSWORD } = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Inventory app listening on http://localhost:${PORT}`);
  if (ADMIN_PASSWORD === 'changeme') {
    console.warn('WARNING: Using default admin password. Set ADMIN_USER / ADMIN_PASSWORD env vars before exposing this beyond localhost.');
  }
});
