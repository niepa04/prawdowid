// test_model2_cli.js - Interaktywny tester Modelu 2 w konsoli
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { model2 } = require('./model2');

async function main() {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'qwen3.5:9b';

  console.log('=== KOMA Model 2 - interaktywny tester ===');
  console.log(`OLLAMA_URL:   ${ollamaUrl}`);
  console.log(`OLLAMA_MODEL: ${model}`);
  console.log('Wpisz tekst do analizy (lub "exit" aby wyjść).\n');

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const tekst = await rl.question('Tekst> ');
      const trimmed = tekst.trim();

      if (!trimmed) continue;
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        break;
      }

      const start = Date.now();
      try {
        const wynik = await model2(trimmed);
        const czasMs = Date.now() - start;
        console.log(`\n--- Wynik (${czasMs} ms) ---`);
        console.log(JSON.stringify(wynik, null, 2));
        console.log('---------------------------\n');
      } catch (err) {
        const czasMs = Date.now() - start;
        console.error(`\n[BŁĄD po ${czasMs} ms] ${err.code || 'ERROR'}: ${err.message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

main();
