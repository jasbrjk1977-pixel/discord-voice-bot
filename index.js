require('dotenv').config();
const { OpenAI } = require('openai');
const { AssemblyAI } = require('assemblyai');
const ElevenLabs = require('elevenlabs-node');
const { joinVoiceChannel, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus, createAudioPlayer, EndBehaviorType } = require('@discordjs/voice');
const {GatewayIntentBits } = require('discord-api-types/v10');
const { Events, Client } = require('discord.js');
const prism = require('prism-media');

const voice = new ElevenLabs({
    apiKey: process.env.ELEVENLABS_API_KEY
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assemblyAI = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

const client = new Client({
 intents: [GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.Guilds],
});

client.on(Events.ClientReady, () => console.log('Ready!'));

client.on(Events.MessageCreate, async message => {
  if (message.content.toLowerCase() === '!join') {
    channel = message.member.voice.channel;
    if (channel) {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      const receiver = connection.receiver;

      connection.on(VoiceConnectionStatus.Ready, () => {
        message.reply(`Joined voice channel: ${channel.name}!`);
        listenAndRespond(connection, receiver, message);
      });
    } else {
      message.reply('You need to join a voice channel first!');
    }
  }
});
  
async function listenAndRespond(connection, receiver, message) {

    const transcriber = assemblyAI.realtime.transcriber({
      sampleRate: 48000
    });
  
    transcriber.on('open', ({ sessionId }) => {
      console.log(`Real-time session opened with ID: ${sessionId}`);
    });
  
    transcriber.on('error', (error) => {
      console.error('Real-time transcription error:', error);
    });
  
    transcriber.on('close', (code, reason) => {
      console.log('Real-time session closed:', code, reason);
    });
  
    var transcription = ""
    transcriber.on('transcript', (transcript) => {
      if (transcript.message_type === 'FinalTranscript') {
        console.log('Final:', transcript.text);
        transcription += transcript.text + " ";
      }
    });
  
    await transcriber.connect();
  
    const audioStream = receiver.subscribe(message.author.id, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000,
      },
    });
  
    const opusDecoder = new prism.opus.Decoder({ rate: 48000, channels: 1 });
  
    audioStream.pipe(opusDecoder).on('data', (chunk) => {
      transcriber.sendAudio(chunk);
    });
  
    audioStream.on('end', async () => {
      await transcriber.close();
      console.log("Final text:", transcription);
      if (!transcription.trim()) {
        console.log("No speech detected, listening again...");
        listenAndRespond(connection, receiver, message);
        return;
      }
      const chatGPTResponse = await getChatGPTResponse(transcription);
      console.log("ChatGPT response:", chatGPTResponse);
      const audioPath = await convertTextToSpeech(chatGPTResponse);
      if (!audioPath) {
        console.log("Audio generation failed, listening again...");
        listenAndRespond(connection, receiver, message);
        return;
      }
      const audioResource = createAudioResource(      const audioResource = createAudioResource(audioPath, {
          inputType: StreamType.Arbitrary,
      });
      const player = createAudioPlayer();
      player.play(audioResource);
      connection.subscribe(player);
  
      player.on(AudioPlayerStatus.Idle, () => {
        console.log('Finished playing audio response.');
        player.stop();
          // Listen for the next user query
        listenAndRespond(connection, receiver, message);
      });
    });
  }

client.on(Events.Error, console.warn);

void client.login(process.env.DISCORD_TOKEN);

// Function to get response from ChatGPT
async function getChatGPTResponse(text) {
    try {
        const response = await openai.completions.create({
            model: "gpt-3.5-turbo-instruct-0914",
            prompt: text,
            max_tokens: 100,
        });
        return response.choices[0].text.trim();
    } catch (error) {
        console.error('Error with ChatGPT:', error);
        return 'I am having trouble processing this right now.';
    }
}

// Function to convert text to speech using ElevenLabs
async function convertTextToSpeech(text) {
    const fileName = `${Date.now()}.mp3`;
    try {
        const response = await voice.textToSpeech({ fileName, textInput: text });
        return response.status === 'ok' ? fileName : null;
    } catch (error) {
        console.error('Error with text-to-speech conversion:', error);
        return null;
    }
}
