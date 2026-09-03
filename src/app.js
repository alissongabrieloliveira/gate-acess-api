const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const authRoutes = require('./modules/auth/auth.routes');
const companiesRoutes = require('./modules/companies/companies.routes');
const usersRoutes = require('./modules/users/users.routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/companies', companiesRoutes);
app.use('/api/v1/users', usersRoutes);

app.use(errorHandler);

module.exports = app;
