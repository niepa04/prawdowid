// messengerRoutes.js - Router Express dla webhooka Facebook Messenger (/webhook)
const express = require('express');
const { verifyWebhook, createWebhookPostHandler } = require('./messengerController');

function createMessengerRouter(deps = {}) {
  const router = express.Router();

  const rawJsonParser = express.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  });

  router.get('/webhook', verifyWebhook);
  router.post('/webhook', rawJsonParser, createWebhookPostHandler(deps));

  return router;
}

module.exports = createMessengerRouter;
