const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });
const app = require('./src/app');

const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log(`MIHEARTI API listening on port ${port}`);
});
