// test_model2_cli.js - Interaktywny tester Modelu 2 w konsoli (wielolinijkowe wklejanie, schowek CLIP, plik)
const fs = require('node:fs');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const { model2 } = require('./model2');

function readWindowsClipboard() {
  return execFileSync(
    'powershell',
    ['-NoProfile', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw'],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
}

async function analyzeAndPrint(rawText) {
  let tekst = String(rawText || '').trim();
  // Jeśli użytkownik wkleił cały blok otoczony jedną parą cudzysłowów "..."
  if (tekst.length >= 2 && tekst.startsWith('"') && tekst.endsWith('"')) {
    tekst = tekst.slice(1, -1).trim();
  }
  if (!tekst) {
    console.log('Pusty tekst – nic nie wysłano.\n');
    return;
  }

  console.log(`\nWysyłam ${tekst.length} znaków do Modelu 2...`);
  const start = Date.now();
  try {
    const wynik = await model2(tekst);
    const czasMs = Date.now() - start;
    console.log(`\n--- Wynik (${czasMs} ms, twierdzeń: ${wynik.claims.length}) ---`);
    console.log(JSON.stringify(wynik, null, 2));
    console.log('-------------------------------------------\n');
  } catch (err) {
    const czasMs = Date.now() - start;
    console.error(`\n[BŁĄD po ${czasMs} ms] ${err.code || 'ERROR'}: ${err.message}\n`);
  }
}

async function main() {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://100.127.211.111:11434';
  const model = process.env.OLLAMA_MODEL || 'qwen3.5:9b';

  console.log('=== KOMA Model 2 - interaktywny tester ===');
  console.log(`OLLAMA_URL:   ${ollamaUrl}`);
  console.log(`OLLAMA_MODEL: ${model}`);

  // 1. Opcja z plikiem: node test_model2_cli.js artykul.txt
  const fileArg = process.argv[2];
  if (fileArg) {
    const tekst = fs.readFileSync(fileArg, 'utf8');
    console.log(`Wczytano z pliku: ${fileArg}`);
    await analyzeAndPrint(tekst);
    return;
  }

  console.log('\nJak używać:');
  console.log('  1) Wklej dowolnie długi tekst (z wieloma liniami, [TEKST], [LINKI], [ZDJĘCIA]),');
  console.log('     a potem w nowej linii wpisz: END  i naciśnij Enter.');
  console.log('  2) ALBO skopiuj tekst (Ctrl+C), wpisz: CLIP  i naciśnij Enter (czyta prosto ze schowka!).');
  console.log('  3) Aby wyjść, wpisz: exit\n');
  console.log('Wklej tekst (zakończ linią END) lub wpisz CLIP / exit:');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  let buffer = [];
  let busy = false;

  rl.on('line', async (line) => {
    if (busy) return;
    const trimmed = line.trim();

    if (buffer.length === 0 && (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit')) {
      rl.close();
      return;
    }

    if (buffer.length === 0 && trimmed.toUpperCase() === 'CLIP') {
      busy = true;
      rl.pause();
      try {
        const clipText = readWindowsClipboard();
        await analyzeAndPrint(clipText);
      } catch (err) {
        console.error(`[BŁĄD SCHOWKA] ${err.message}\n`);
      } finally {
        busy = false;
        console.log('Wklej kolejny tekst (zakończ linią END) lub wpisz CLIP / exit:');
        rl.resume();
      }
      return;
    }

    if (trimmed === 'END') {
      const fullText = buffer.join('\n');
      buffer = [];
      busy = true;
      rl.pause();
      try {
        await analyzeAndPrint(fullText);
      } finally {
        busy = false;
        console.log('Wklej kolejny tekst (zakończ linią END) lub wpisz CLIP / exit:');
        rl.resume();
      }
      return;
    }

    buffer.push(line);
  });

  rl.on('close', async () => {
    // Obsługa Ctrl+Z (EOF) na końcu wklejonego tekstu
    if (!busy && buffer.length > 0) {
      const fullText = buffer.join('\n');
      buffer = [];
      await analyzeAndPrint(fullText);
    }
  });
}

main();
