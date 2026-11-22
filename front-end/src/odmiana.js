// Polska odmiana rzeczownika przy liczbie (np. 1 materiał, 2 materiały, 5 materiałów, 22 materiały).
export function odmiana(liczba, pojedyncza, kilka, wiele) {
  if (liczba === 1) return pojedyncza;
  const mod10 = liczba % 10;
  const mod100 = liczba % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return kilka;
  return wiele;
}
