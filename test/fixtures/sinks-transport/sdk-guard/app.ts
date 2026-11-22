import express from 'express';
import { localhostHostValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
export const app = express();
app.use(localhostHostValidation());
