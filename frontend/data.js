/*
  DATA.JS
  --------------------------------------------------------
  This file stands in for your DATABASE for now.
  Later (Step 2 of our plan) we'll delete this file and
  fetch the same shaped data from Supabase instead —
  every render function in script.js/ledger.js will keep
  working exactly the same, because they don't care WHERE
  the data comes from, only what shape it's in.

  That's a pretty important habit in web dev: keep your
  "get the data" step separate from your "show the data"
  step, so you can swap one without rewriting the other.
  --------------------------------------------------------
*/

const SERVER = {
  name: "KLCSH Legacy",
};

// The goal shown big, at the top of the homepage
const SPOTLIGHT_GOAL = {
  title: "New survival server hardware",
  target: 600,
  current: 340,
  deadline: "August 25, 2026",
};

// Smaller goals shown in the grid further down
const OTHER_GOALS = [
  { title: "Domain renewal", target: 1174, current: 0 },
  //{ title: "Anti-cheat plugin license", target: 0, current: 0 },
  //{ title: "Backup storage (6 months)", target: 0, current: 0 },
  //{ title: "Community event prizes", target: 0, current: 0 },
];

/*
  Every contribution ever made. Newest first. Pulled from the real
  contributions spreadsheet — one entry per (member, month) that
  actually has a logged amount. Members with no contribution
  recorded yet aren't in here at all, since there's no transaction
  to show.

  `name` uses the member's GAMERTAG (in-game name), not their real
  name — matches how the rest of the app treats real names as
  private/encrypted and only ever shows the in-game name publicly.

  Days are set to the 25th of each month (the site's monthly due
  date), since the source sheet only tracked which MONTH a payment
  landed in, not the exact day.

  Note: "Akispade1209" appears twice with the same July (15) but
  very different August amounts (45 vs 485) — that's copied
  straight from the source sheet as given. Worth double-checking
  against the original spreadsheet in case 485 was meant to be 45
  (or it's two different people who happened to share a gamertag).

  In Step 2, this array gets replaced by rows from Supabase's
  `payment_submissions` table instead.
*/
const CONTRIBUTIONS = [
  { name: "Cianxcx143",       amount: 46,  date: "2026-08-25", message: "" },
  { name: "SableWave8829",    amount: 45,  date: "2026-08-25", message: "" },
  { name: "cheesecakez2378",  amount: 235, date: "2026-08-25", message: "" },
  { name: "GsusFries28",      amount: 45,  date: "2026-08-25", message: "" },
  { name: "BACKBURNER6367",   amount: 45,  date: "2026-08-25", message: "" },
  { name: "LilyClouds",       amount: 35,  date: "2026-08-25", message: "" },
  { name: "Vanzv1554",        amount: 73,  date: "2026-08-25", message: "" },
  { name: "nathan70383",      amount: 45,  date: "2026-08-25", message: "" },
  { name: "Akispade1209",     amount: 45,  date: "2026-08-25", message: "" },
  { name: "Lovee Lady6017",   amount: 45,  date: "2026-08-25", message: "" },
  { name: "Akispade1209",     amount: 485, date: "2026-08-25", message: "" },
  { name: "Yroma21",          amount: 85,  date: "2026-08-25", message: "" },
  { name: "Damz0209",         amount: 65,  date: "2026-07-25", message: "" },
  { name: "Ponkan Juice",     amount: 15,  date: "2026-07-25", message: "" },
  { name: "Cianxcx143",       amount: 15,  date: "2026-07-25", message: "" },
  { name: "SableWave8829",    amount: 15,  date: "2026-07-25", message: "" },
  { name: "cheesecakez2378",  amount: 15,  date: "2026-07-25", message: "" },
  { name: "GsusFries28",      amount: 15,  date: "2026-07-25", message: "" },
  { name: "BACKBURNER6367",   amount: 15,  date: "2026-07-25", message: "" },
  { name: "LilyClouds",       amount: 15,  date: "2026-07-25", message: "" },
  { name: "Vanzv1554",        amount: 15,  date: "2026-07-25", message: "" },
  { name: "nathan70383",      amount: 15,  date: "2026-07-25", message: "" },
  { name: "Akispade1209",     amount: 15,  date: "2026-07-25", message: "" },
  { name: "Lovee Lady6017",   amount: 15,  date: "2026-07-25", message: "" },
  { name: "Akispade1209",     amount: 15,  date: "2026-07-25", message: "" },
  { name: "Yroma21",          amount: 15,  date: "2026-07-25", message: "" },
  { name: "SilentBeast8332",  amount: 75,  date: "2026-06-25", message: "" },
  { name: "taki",             amount: 25,  date: "2026-06-25", message: "" },
  { name: "Lei for 3, whii!", amount: 100, date: "2026-06-25", message: "" },
  { name: "Phamiiii",         amount: 50,  date: "2026-06-25", message: "" },
  { name: "TORCHY2746",       amount: 80,  date: "2026-06-25", message: "" },
  { name: "kDee024k",         amount: 25,  date: "2026-06-25", message: "" },
  { name: "Henkz47",          amount: 25,  date: "2026-06-25", message: "" },
  { name: "Lily Luxanna",     amount: 25,  date: "2026-06-25", message: "" },
  { name: "Ramenvk",          amount: 120, date: "2026-06-25", message: "" },
  { name: "ALTROSON",         amount: 80,  date: "2026-06-25", message: "" },
  { name: "DEVONE8",          amount: 80,  date: "2026-06-25", message: "" },
  { name: "Seigie",           amount: 45,  date: "2026-06-25", message: "" },
  { name: "KerTz2008",        amount: 70,  date: "2026-06-25", message: "" },
  { name: "MrBuilder7372",    amount: 25,  date: "2026-06-25", message: "" },
  { name: "Damz0209",         amount: 75,  date: "2026-06-25", message: "" },
  { name: "LynLin",           amount: 25,  date: "2026-06-25", message: "" },
  { name: "BlanK0630",        amount: 75,  date: "2026-06-25", message: "" },
  { name: "Choccimysm",       amount: 30,  date: "2026-06-25", message: "" },
  { name: "SableWave8829",    amount: 50,  date: "2026-06-25", message: "" },
  { name: "cheesecakez2378",  amount: 30,  date: "2026-06-25", message: "" },
  { name: "Scrofa7518",       amount: 25,  date: "2026-06-25", message: "" },
  { name: "GsusFries28",      amount: 25,  date: "2026-06-25", message: "" },
  { name: "BACKBURNER6367",   amount: 25,  date: "2026-06-25", message: "" },
  { name: "xorainee",         amount: 25,  date: "2026-06-25", message: "" },
  { name: "Unstoppablepuff",  amount: 25,  date: "2026-06-25", message: "" },
  { name: "Backheim",         amount: 30,  date: "2026-06-25", message: "" },
  { name: "SilentBeast8332",  amount: 80,  date: "2026-05-25", message: "" },
  { name: "FiLTer1016273",    amount: 80,  date: "2026-05-25", message: "" },
  { name: "Kingkongkongkon",  amount: 80,  date: "2026-05-25", message: "" },
  { name: "taki",             amount: 100, date: "2026-05-25", message: "" },
  { name: "Rn_Barbielat",     amount: 80,  date: "2026-05-25", message: "" },
  { name: "DaverJohn22",      amount: 80,  date: "2026-05-25", message: "" },
  { name: "ramram rys",       amount: 80,  date: "2026-05-25", message: "" },
  { name: "Lei for 3, whii!", amount: 80,  date: "2026-05-25", message: "" },
  { name: "Phamiiii",         amount: 100, date: "2026-05-25", message: "" },
  { name: "TORCHY2746",       amount: 80,  date: "2026-05-25", message: "" },
  { name: "kDee024k",         amount: 80,  date: "2026-05-25", message: "" },
  { name: "Henkz47",          amount: 80,  date: "2026-05-25", message: "" },
  { name: "Lily Luxanna",     amount: 80,  date: "2026-05-25", message: "" },
  { name: "Ramenvk",          amount: 80,  date: "2026-05-25", message: "" },
  { name: "MrBuilder7372",    amount: 80,  date: "2026-05-25", message: "" },
];
