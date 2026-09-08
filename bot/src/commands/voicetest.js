/**
 * /음성테스트 — 배포 환경에서 디스코드 음성 UDP 가 뚫리는지 확인하는 진단 명령
 *
 * 왜 이게 별도 명령으로 있는가:
 *   Railway 에서 "코드 변경 없이 어느 날부터 음성 연결이 signalling→connecting 을 반복하다
 *   15초 타임아웃" 사례가 미해결로 보고돼 있다. 플레이리스트 재생 기능 전체가 여기에 달려 있어서,
 *   yt-dlp 같은 무거운 조각을 붙이기 전에 이 경로만 따로 확인한다.
 *
 * 커밋된 짧은 Ogg/Opus 파일을 그대로 흘려보낸다. 실제 재생과 같은 경로(StreamType.OggOpus)라
 * 여기서 소리가 나면 재생 기능의 토대는 확인된 셈이다.
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  getVoiceConnection,
} from '@discordjs/voice';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, fail } from '../embeds.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TONE = path.join(HERE, '..', '..', 'assets', 'tone.ogg');

export default {
  data: new SlashCommandBuilder()
    .setName('음성테스트')
    .setDescription('음성 채널 연결이 되는지 확인합니다 (짧은 소리를 재생).'),

  async execute(interaction) {
    const channel = interaction.member?.voice?.channel;
    if (!channel) {
      await interaction.reply({
        embeds: [fail('먼저 음성 채널에 들어가 주세요.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const log = [];
    const t0 = Date.now();
    const mark = (s) => log.push(`${String(Date.now() - t0).padStart(5)}ms  ${s}`);

    let connection;
    try {
      connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
      });
      mark('joinVoiceChannel 호출');

      // 여기서 막히는 것이 위에 적은 UDP 문제의 증상이다.
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      mark('연결 Ready ✔');

      const player = createAudioPlayer();
      connection.subscribe(player);
      player.play(createAudioResource(createReadStream(TONE), { inputType: StreamType.OggOpus }));
      mark('재생 시작');

      await entersState(player, AudioPlayerStatus.Playing, 10_000);
      mark('오디오 송출 확인 ✔');

      await entersState(player, AudioPlayerStatus.Idle, 20_000);
      mark('재생 완료 ✔');

      await interaction.editReply({
        embeds: [base({
          title: '음성 연결 정상',
          description: `\`\`\`\n${log.join('\n')}\n\`\`\``,
          footer: '소리가 실제로 들렸는지도 확인해 주세요.',
        })],
      });
    } catch (err) {
      mark(`실패: ${err.message}`);
      await interaction.editReply({
        embeds: [fail(
          `음성 연결에 실패했어요.\n\`\`\`\n${log.join('\n')}\n\`\`\`\n`
          + 'Ready 단계에서 타임아웃이면 이 호스트에서 디스코드 음성 UDP 가 막힌 것입니다.',
        )],
      });
    } finally {
      // 진단용이므로 항상 끊는다. 남겨두면 다음 테스트가 기존 연결을 재사용해 결과가 흐려진다.
      getVoiceConnection(channel.guild.id)?.destroy();
    }
  },
};
