// Function da Vercel: toda requisição é reescrita para cá (ver vercel.json). O código vem do build (dist/).
module.exports = require('../dist/serverless.js').default;
