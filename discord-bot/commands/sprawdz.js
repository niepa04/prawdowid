const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  checkStatus,
  verifyInput,
  parseAndValidateLinks,
  downloadAttachmentAsDataUri,
  KomaApiError,
  MAX_TEXT_LENGTH,
} = require('../services/komaApi');
const { buildVerificationMessages } = require('../utils/formatVerdict');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sprawdz')
    .setDescription('Weryfikuje tekst, linki lub zdjęcie za pomocą systemu KOMA.')
    .addStringOption((option) =>
      option
        .setName('tekst')
        .setDescription('Tekst lub twierdzenie do zweryfikowania.')
        .setRequired(false)
        .setMaxLength(6000)
    )
    .addStringOption((option) =>
      option
        .setName('linki')
        .setDescription('Link lub kilka linków (oddzielonych spacją lub przecinkiem) do zweryfikowania.')
        .setRequired(false)
        .setMaxLength(4000)
    )
    .addAttachmentOption((option) =>
      option
        .setName('zdjecie')
        .setDescription('Zdjęcie lub zrzut ekranu (PNG, JPG, WEBP, GIF, BMP, maks. 5 MB) do analizy OCR.')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const rawText = interaction.options.getString('tekst') || '';
    const rawLinks = interaction.options.getString('linki') || '';
    const attachment = interaction.options.getAttachment('zdjecie');

    const trimmedText = rawText.trim();
    const hasText = trimmedText.length > 0;
    const hasLinksRaw = rawLinks.trim().length > 0;
    const hasImage = Boolean(attachment);

    if (!hasText && !hasLinksRaw && !hasImage) {
      const missingEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('Brak danych do weryfikacji')
        .setDescription(
          'Podaj przynajmniej jeden z parametrów komendy `/sprawdz`: `tekst`, `linki` lub `zdjecie`.'
        );
      await interaction.editReply({ embeds: [missingEmbed] });
      return;
    }

    if (trimmedText.length > MAX_TEXT_LENGTH) {
      const invalidEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('Tekst jest zbyt długi')
        .setDescription(`Maksymalna dozwolona długość tekstu to ${MAX_TEXT_LENGTH} znaków.`);
      await interaction.editReply({ embeds: [invalidEmbed] });
      return;
    }

    let parsedLinks = [];
    try {
      if (hasLinksRaw) {
        parsedLinks = parseAndValidateLinks(rawLinks);
      }
    } catch (err) {
      const invalidLinksEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('Nieprawidłowe linki')
        .setDescription(err.message);
      await interaction.editReply({ embeds: [invalidLinksEmbed] });
      return;
    }

    // Nie pozwalaj uruchamiać analizy, jeśli backend KOMA jest niedostępny
    const statusResult = await checkStatus();
    if (!statusResult.available) {
      const offlineEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('Backend KOMA jest niedostępny')
        .setDescription(
          'Nie można uruchomić weryfikacji, ponieważ serwer KOMA nie odpowiada.\n' +
            `Powód: ${statusResult.error || 'Brak połączenia z backendem.'}`
        );
      await interaction.editReply({ embeds: [offlineEmbed] });
      return;
    }

    try {
      const zdjecia = [];
      if (attachment) {
        const dataUri = await downloadAttachmentAsDataUri(attachment);
        zdjecia.push(dataUri);
      }

      const wynik = await verifyInput({
        tekst: trimmedText,
        linki: parsedLinks,
        zdjecia,
      });

      const messages = buildVerificationMessages(wynik, {
        tekst: trimmedText,
        linki: parsedLinks,
        zdjecieNazwa: attachment ? attachment.name || 'załącznik' : null,
      });

      if (messages.length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle('Brak danych do wyświetlenia')
          .setDescription('Backend KOMA zakończył analizę, ale nie zwrócił treści do wyświetlenia.');
        await interaction.editReply({ embeds: [emptyEmbed] });
        return;
      }

      await interaction.editReply(messages[0]);

      for (let i = 1; i < messages.length; i += 1) {
        await interaction.followUp(messages[i]);
      }
    } catch (err) {
      const isKomaErr = err instanceof KomaApiError;
      const details = [];
      if (isKomaErr && err.etap) details.push(`Etap: \`${err.etap}\``);
      if (isKomaErr && err.status) details.push(`Kod HTTP: \`${err.status}\``);

      const errorEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('Błąd podczas weryfikacji')
        .setDescription(err.message || 'Wystąpił nieoczekiwany błąd podczas komunikacji z systemem KOMA.');

      if (details.length > 0) {
        errorEmbed.addFields({ name: 'Szczegóły techniczne', value: details.join(' | ') });
      }

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
