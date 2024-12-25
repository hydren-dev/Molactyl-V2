const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const config = require('./config.json');

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ]
});

// Helper function to check if a user is an admin
const isAdmin = (userId) => config.admin_users.includes(userId);

// Generate a random 5-digit number
const getRandomNumber = () => Math.floor(10000 + Math.random() * 90000);

// Get a random node ID
const getRandomNode = () => {
  const nodes = JSON.parse(fs.readFileSync(path.join(__dirname, 'storage', 'nodes.json')));
  const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
  return randomNode.id;
};

// Bot ready event
client.once('ready', () => {
  console.log(`${client.user.tag} is online!`);
});

// Command handler
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(config.prefix) || message.author.bot) return;

  const args = message.content.slice(config.prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // Register Command
  if (command === 'register') {
    try {
      const guild = message.guild;
      const member = message.member;

      // Check if user already registered
      const userExists = await axios.post(`${config.url}/api/getUser`, {
        type: 'email',
        value: args[0]
      }, {
        headers: { 'x-api-key': config.key }
      }).catch(err => err.response);

      if (userExists && userExists.status === 201) {
        return message.reply("Email already taken.");
      }

      if (userExists && userExists.status !== 400) {
        return message.reply("An error occurred. Please try again later.");
      }

      // Create private channel
      const channel = await guild.channels.create({
        name: `registration-${message.author.username}`,
        type: 0, // Text channel
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: member.id,
            allow: [PermissionsBitField.Flags.ViewChannel]
          }
        ]
      });

      channel.send("Please provide your Email:");
      const collectedEmail = await channel.awaitMessages({
        filter: m => m.author.id === member.id,
        max: 1,
        time: 60000
      });

      const email = collectedEmail.first().content;

      channel.send("Please provide your Username:");
      const collectedUsername = await channel.awaitMessages({
        filter: m => m.author.id === member.id,
        max: 1,
        time: 60000
      });

      const username = collectedUsername.first().content;

      // Generate random password
      const password = uuidv4().slice(0, 8);

      // Send user creation request
      const createUserResponse = await axios.post(`${config.url}/api/auth/create-user`, {
        username,
        email,
        password,
        userId: message.author.id
      }, {
        headers: { 'x-api-key': config.key }
      }).catch(err => err.response);

      if (createUserResponse && createUserResponse.status === 201) {
        // Send credentials via DM
        const embed = new EmbedBuilder()
          .setTitle("Account Details")
          .setColor(0x00AE86)
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "Email", value: email, inline: true },
            { name: "Password", value: password, inline: false }
          )
          .setFooter({ text: "Please save this information securely!" });

        await message.author.send({ embeds: [embed] });
        channel.send("Your account has been created! Please check your DMs for login details.");

        setTimeout(() => {
          channel.delete().catch(console.error);
        }, 300000); // Delete channel after 5 minutes
      } else {
        channel.send("An error occurred while creating the user. Please try again later.");
      }
    } catch (error) {
      console.error(error);
      message.reply("An unexpected error occurred.");
    }
  }
  if (command === 'fetchimages') {
    if (!isAdmin(message.author.id)) {
      return message.reply("You do not have permission to use this command.");
    }

    try {
      const response = await axios.get(`${config.url}/api/images`, {
        headers: { 'x-api-key': config.key }
      });

      const imagesPath = path.join(__dirname, 'storage', 'images.json');
      fs.writeFileSync(imagesPath, JSON.stringify(response.data, null, 2));
      message.reply("Images have been successfully fetched and saved.");
    } catch (error) {
      console.error(error);
      message.reply("An error occurred while fetching images. Please try again later.");
    }
  }

  // Fetch Nodes Command
  if (command === 'fetchnodes') {
    if (!isAdmin(message.author.id)) {
      return message.reply("You do not have permission to use this command.");
    }

    try {
      const response = await axios.get(`${config.url}/api/nodes`, {
        headers: { 'x-api-key': config.key }
      });

      const nodesPath = path.join(__dirname, 'storage', 'nodes.json');
      fs.writeFileSync(nodesPath, JSON.stringify(response.data, null, 2));
      message.reply("Nodes have been successfully fetched and saved.");
    } catch (error) {
      console.error(error);
      message.reply("An error occurred while fetching nodes. Please try again later.");
    }
  }

  // Deploy Command
  if (command === 'deploy') {
    if (args.length < 4) {
      return message.reply("Usage: !deploy <memory> <cpu> <imageName> <name>");
    }

    const [memory, cpu, imageName, name] = args;
    const images = JSON.parse(fs.readFileSync(path.join(__dirname, 'storage', 'images.json')));
    const image = images.find((img) => img.name === imageName);

    if (!image) {
      return message.reply("Image not found.");
    }

    const variables = {};
    if (image.Variables) {
      for (const [key, value] of Object.entries(image.Variables)) {
        if (value.required && !args.includes(key)) {
          return message.reply(`Variable ${key} is required but not provided.`);
        }
        variables[key] = value.default || args[key];
      }
    }

    const randomPort = getRandomNumber();
    const randomNodeId = getRandomNode();

    try {
      const response = await axios.post(`${config.url}/api/instances/deploy`, {
        image: image.id,
        imagename: imageName,
        memory,
        cpu,
        name,
        ports: `${randomPort}:${randomPort}`,
        nodeId: randomNodeId,
        user: message.author.id,
        primary: randomPort,
        variables: JSON.stringify(variables)
      }, {
        headers: { 'x-api-key': config.key }
      });

      if (response.status === 201) {
        const embed = new EmbedBuilder()
          .setTitle("Instance Created")
          .setDescription(`Access your server [here](${config.url}/instance/${response.data.volumeId})`)
          .addFields(
            { name: "Memory", value: memory, inline: true },
            { name: "CPU", value: cpu, inline: true },
            { name: "Image", value: imageName, inline: true },
            { name: "Name", value: name, inline: true }
          )
          .setFooter({ text: "Warning: Abusing the server may lead to suspension." })
          .setColor(0x00FF00);

        message.author.send({ embeds: [embed] });
        message.reply("Instance created successfully!");
      }
    } catch (error) {
      console.error(error);
      message.reply("An error occurred while creating the instance. Please try again later.");
    }
  }
});

// Login bot
client.login(config.token);
