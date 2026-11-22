const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkStatus, getBackendUrl } = require('../services/komaApi');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Sprawdza dostępność backendu KOMA oraz status jego modułów.'),

  async execute(interaction) {
    await interaction.deferReply();

    const result = await checkStatus();

    if (!result.available) {
      const offlineEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('Status backendu KOMA: Niedostępny')
        .setDescription(result.error || 'Nie udało się połączyć z backendem KOMA.')
        .addFields({ name: 'Skonfigurowany adres API', value: `\`${getBackendUrl()}\`` });

      await interaction.editReply({ embeds: [offlineEmbed] });
      return;
    }

    const { data } = result;
    const pipelineText = Array.isArray(data.pipeline) && data.pipeline.length > 0
      ? data.pipeline.join(' → ')
      : 'Brak danych';

    let sourcesText = 'Brak danych';
    if (data.zrodla_oficjalne) {
      if (data.zrodla_oficjalne.blad) {
        sourcesText = `Błąd: ${data.zrodla_oficjalne.blad}`;
      } else {
        sourcesText = `Aktywne: ${data.zrodla_oficjalne.aktywne ?? '?'} / Łącznie: ${data.zrodla_oficjalne.lacznie ?? '?'}`;
      }
    }

    const onlineEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('Status backendu KOMA: Online')
      .setDescription('Połączenie z backendem KOMA działa poprawnie.')
      .addFields(
        { name: 'Aplikacja', value: String(data.app || 'prawdowid'), inline: true },
        { name: 'Status', value: String(data.status || 'ok'), inline: true },
        { name: 'Pipeline', value: pipelineText },
        { name: 'Oficjalne źródła', value: sourcesText },
        { name: 'Adres API', value: `\`${getBackendUrl()}\`` }
      );

    await interaction.editReply({ embeds: [onlineEmbed] });
  },
};
