const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pomoc')
    .setDescription('Wyświetla informacje o bocie KOMA (PRAWDOWID) i dostępnych komendach.'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('KOMA (PRAWDOWID) – Bot do weryfikacji informacji')
      .setDescription(
        'Ten bot jest interfejsem Discord do systemu **KOMA / PRAWDOWID**, który automatycznie ' +
          'analizuje wypowiedzi, wyodrębnia twierdzenia, przeszukuje oficjalne źródła oraz bazy ' +
          'fact-checkingowe i przedstawia werdykt wraz z uzasadnieniem.'
      )
      .addFields(
        {
          name: 'Dostępne komendy',
          value:
            '• `/sprawdz [tekst] [linki] [zdjecie]` – wysyła tekst, linki i/lub zdjęcie (OCR) do backendu KOMA i wyświetla szczegółowy werdykt.\n' +
            '• `/status` – sprawdza, czy backend KOMA jest uruchomiony i gotowy do pracy.\n' +
            '• `/pomoc` – wyświetla tę wiadomość.',
        },
        {
          name: 'Możliwe werdykty systemu KOMA',
          value:
            '✅ **Potwierdzone** – dowody wprost potwierdzają twierdzenie.\n' +
            '❌ **Fałszywe** – dowody wprost zaprzeczają twierdzeniu.\n' +
            '⚠️ **Wprowadzające w błąd** – twierdzenie jest częściowo prawdziwe, pomija kontekst lub zniekształca szczegóły.\n' +
            '❓ **Brak wystarczających dowodów** – nie znaleziono materiałów pozwalających na rozstrzygnięcie.\n' +
            'ℹ️ **Nie podlega weryfikacji** – opinia, ocena wartościująca lub wypowiedź niefaktograficzna.',
        }
      )
      .setFooter({ text: 'Analiza może potrwać od kilku sekund do kilku minut w zależności od złożoności tekstu.' });

    await interaction.reply({ embeds: [embed] });
  },
};
