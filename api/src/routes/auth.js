const express = require('express');
const Client  = require('../models/Client');

const router = express.Router();

// POST /auth/register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email et password sont requis' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
  }

  try {
    const client = await Client.create({ name, email, password });
    return res.status(201).json({
      message: 'Compte créé avec succès',
      apiKey: client.apiKey,
      name: client.name,
      email: client.email,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Un compte avec cet email existe déjà' });
    }
    console.error('[register]', err.message);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email et password sont requis' });
  }

  try {
    const client = await Client.findOne({ email: email.toLowerCase(), active: true });

    if (!client || !(await client.verifyPassword(password))) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    return res.status(200).json({
      message: 'Connexion réussie',
      apiKey: client.apiKey,
      name: client.name,
      email: client.email,
    });
  } catch (err) {
    console.error('[login]', err.message);
    return res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;
