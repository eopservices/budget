import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend, AreaChart, Area, ComposedChart } from "recharts";
import { supabase } from "./supabase";

// ─── CATEGORY MAPPING ENGINE ───
const CATEGORY_RULES = [
  { pattern: /coles|woolworths|aldi(?!mobile)|hierba|7-eleven.*(?!fuel)/i, category: "Groceries" },
  { pattern: /bp |ampol|shell|caltex|7-eleven.*fuel|united petrol/i, category: "Fuel" },
  { pattern: /sushi|domino|zambrero|grill.?d|yo-chi|burrito|betty|mcdonald|kfc|hungry|subway|pizza|noodle|thai|chinese|curry|ramen|gyg|guzman|beach house|sahara|shanghai|hero sushi|hane sushi|kinn|gelatissimo|wara sushi|chamm/i, category: "Restaurants & Takeaway" },
  { pattern: /fort specialty|starbucks|coffee|cafe/i, category: "Cafe & Coffee" },
  { pattern: /disney|spotify|netflix|apple\.com.*bill|amazon.*prime|youtube/i, category: "Subscriptions" },
  { pattern: /bupa|medibank|nib.*health/i, category: "Health Insurance" },
  { pattern: /allianz|aami|nrma|qbe.*insur|house insur/i, category: "House Insurance" },
  { pattern: /car insur/i, category: "Car Insurance" },
  { pattern: /anytime fitness|gym|fitness/i, category: "Health & Fitness" },
  { pattern: /telstra|optus|vodafone|aldimobile/i, category: "Mobile" },
  { pattern: /claude\.ai|figma|supabase|adobe|xero|google workspace|microsoft.*(?:365|workspace)|n8n|paddle.*n8n|github/i, category: "EOP Software" },
  { pattern: /unitywater|energex|origin energy|agl|electricity|water.*bill/i, category: "Eclipse Utilities" },
  { pattern: /mortgage|home loan/i, category: "Mortgage" },
  { pattern: /car loan|vehicle finance/i, category: "Car Loan" },
  { pattern: /rego|registration/i, category: "Car Rego" },
  { pattern: /linkt|toll|parking|car park/i, category: "Transport & Parking" },
  { pattern: /translink|bus|train|ferry/i, category: "Public Transport" },
  { pattern: /cineplex|cinema|movie|event/i, category: "Entertainment" },
  { pattern: /bunnings|home improvement/i, category: "Home Improvements" },
  { pattern: /chemist|doctor|medical|pharmacy|medicare/i, category: "Medical" },
  { pattern: /world vision|charit|donat/i, category: "Donations" },
  { pattern: /barber|haircut|personal care/i, category: "Personal Care" },
  { pattern: /amazon(?!.*prime)|ebay|kmart|target|big w/i, category: "Shopping" },
  { pattern: /rent.*eclipse|eclipse.*rent/i, category: "Eclipse Rent (Income)" },
  { pattern: /improve it|electrical.*pty/i, category: "Wages (Income)" },
  { pattern: /interest|payment$/i, category: "Interest (Income)" },
  { pattern: /birthday|gift/i, category: "Gifts (Income)" },
];

function categorizeTransaction(details, merchantName = "", originalDesc = "") {
  const searchStr = `${details} ${merchantName} ${originalDesc}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(searchStr)) return rule.category;
  }
  return "General";
}

// ─── CSV PARSERS ───
function parseCreditCardCSV(text) {
  const lines = text.trim().split("\n");
  const transactions = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 9) continue;
    const date = parts[0]?.trim();
    const amount = parseFloat(parts[1]);
    const type = parts[4]?.trim();
    const details = parts[5]?.trim();
    const origCategory = parts[6]?.trim();
    const merchant = parts[7]?.trim();
    if (isNaN(amount)) continue;
    if (type === "CREDIT CARD PAYMENT") continue;
    transactions.push({
      date: parseFlexDate(date),
      amount: Math.abs(amount),
      isExpense: amount < 0,
      details: merchant || details,
      originalCategory: origCategory,
      category: categorizeTransaction(details, merchant, ""),
      account: "Credit Card",
      raw: lines[i],
    });
  }
  return transactions;
}

function parseBankCSV(text) {
  const lines = text.trim().split("\n");
  const transactions = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (row.length < 11) continue;
    const date = row[0];
    const details = row[1];
    const account = row[2];
    const category = row[3];
    const debit = parseFloat(row[7]) || 0;
    const credit = parseFloat(row[8]) || 0;
    const balance = parseFloat(row[9]) || 0;
    const originalDesc = row[10];
    const isTransfer = /internal transfer|to account|to linked|from linked|to nexus|from nexus|to michael|to eclipse/i.test(originalDesc + " " + details);
    if (isTransfer) continue;
    const amount = debit || credit;
    if (amount === 0) continue;
    transactions.push({
      date: parseFlexDate(date),
      amount,
      isExpense: debit > 0,
      details,
      originalCategory: `${category} > ${row[4]}`,
      category: categorizeTransaction(details, "", originalDesc),
      account,
      balance,
      raw: lines[i],
    });
  }
  return transactions;
}

function parseCSVRow(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else if (ch !== "\r") { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function parseFlexDate(str) {
  if (!str) return new Date();
  const s = str.replace(/"/g, "").trim();
  const m1 = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{2,4})$/);
  if (m1) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    let yr = parseInt(m1[3]);
    if (yr < 100) yr += 2000;
    return new Date(yr, months[m1[2].toLowerCase().slice(0, 3)] ?? 0, parseInt(m1[1]));
  }
  return new Date(s);
}

function detectAndParseCSV(text) {
  const firstLine = text.trim().split("\n")[0];
  if (firstLine.includes("Account Number") && firstLine.includes("Transaction Type")) {
    return parseCreditCardCSV(text);
  }
  return parseBankCSV(text);
}

// ─── BUDGET DATA (from Michael's spreadsheet) ───
const BUDGET = {
  income: {
    "Wages": { jul: 2680, aug: 2680, sep: 2675, oct: 2880, nov: 2680, dec: 1920, jan: 2100, feb: 2773, mar: 5773, apr: 5773, may: 5773, jun: 5773 },
    "Eclipse Rent": { jul: 2925, aug: 2925, sep: 2925, oct: 2925, nov: 2925, dec: 2925, jan: 2925, feb: 3033, mar: 3033, apr: 3033, may: 3033, jun: 3033 },
  },
  expenses: {
    "Health Insurance": { budget: 98.58 },
    "Car Insurance": { budget: 71.68 },
    "Car Loan": { budget: 289.26 },
    "Fuel": { budget: 260 },
    "Mobile": { budget: 131.08 },
    "Health & Fitness": { budget: 80 },
    "Subscriptions": { budget: 72.95 },
    "Groceries": { budget: 350 },
    "General": { budget: 1200 },
    "EOP Software": { budget: 450 },
    "House Insurance": { budget: 122.83 },
    "Eclipse Utilities": { budget: 0, bimonthly: 523.15 },
    "Mortgage": { budget: 1950.59 },
  }
};

// ─── CASH FLOW DATA (12-month FY2025-26) ───
const CF_MONTHS = ["Jul 25","Aug 25","Sep 25","Oct 25","Nov 25","Dec 25","Jan 26","Feb 26","Mar 26","Apr 26","May 26","Jun 26"];
const CF_ACTUAL_MONTHS = [0,1,2,3,4,5,6];
const CF_CUR_MONTH = 6;

const CF = {
  income: {
    "Wages":              [2680,2680,2675,2880,2680,1920,2100,2773.33,5773.33,5773.33,5773.33,5773.33],
    "Eclipse Rent":       [2925,2925,2925,2925,2925,2925,2925,3033,3033,3033,3033,3033],
    "Tax Return":         [0,0,0,0,0,0,0,0,0,0,0,0],
    "Other (Non-Taxable)":[605,0,75,43000,0,0,960,960,0,0,0,0],
  },
  expenses: {
    "Tax":                     [0,0,0,0,0,0,0,0,0,0,0,0],
    "HECS Repayments":         [0,0,0,0,0,0,0,0,0,0,0,0],
    "Rent":                    [0,0,0,0,0,0,0,0,0,1733,1733,1733],
    "Private Health Insurance":[122,98.58,98.58,98.58,98.58,98.58,98.58,98.58,98.58,98.58,98.58,98.58],
    "Car Insurance":           [213.93,245.66,213.93,71.68,71.68,71.68,71.68,71.68,71.68,71.68,71.68,71.68],
    "Car Rego":                [0,0,400,0,0,1048.86,0,0,0,0,0,0],
    "Car Service":             [0,0,0,0,0,350,0,0,0,0,0,0],
    "Car Loan":                [413.26,289.26,289.26,289.26,289.26,289.26,289.26,289.26,289.26,289.26,289.26,289.26],
    "Fuel":                    [137.43,132.20,264.50,465.61,236.38,153.08,260,260,260,260,260,260],
    "Mobile":                  [150,150,211,211,131.08,131.08,131.08,131.08,131.08,131.08,131.08,131.08],
    "Health":                  [0,0,0,0,80,80,80,80,80,80,80,80],
    "Subscriptions":           [322.82,305.90,199.11,72.95,56.96,115.91,72.95,72.95,72.95,72.95,72.95,72.95],
    "Groceries":               [281.42,347.05,366.40,246.16,474.25,341.82,350,350,350,350,350,350],
    "General":                 [1459.02,687.81,1097.27,1648.61,1298.67,2176.44,1200,1200,1200,1200,1200,1200],
    "EOP Software":            [0,421.54,465.33,395.07,430.86,430.86,450,450,450,450,450,450],
    "House Insurance":         [122.83,122.83,122.83,122.83,122.83,122.83,122.83,122.83,122.83,122.83,122.83,122.83],
    "Eclipse Utilities":       [418.77,523.15,409.33,0,523.15,418.77,0,523.15,418.77,0,523.15,418.77],
    "Other":                   [0,0,0,39289,0,0,0,0,0,0,0,0],
    "Mortgage (Consolidated)": [1925.23,1950.59,1950.59,1950.59,1950.59,1950.59,1950.59,1950.59,1950.59,1950.59,1950.59,1950.59],
  },
  totals: {
    income:   [6210,5605,5675,48805,5605,4845,5985,6766.33,8806.33,8806.33,8806.33,8806.33],
    expenses: [5566.71,5274.57,6088.13,44861.34,5764.29,7779.76,5076.97,5600.12,5495.74,6809.97,7333.12,7228.74],
    net:      [643.29,330.43,-413.13,3943.66,-159.29,-2934.76,908.03,1166.21,3310.59,1996.36,1473.21,1577.59],
    savings:  [3493.24,3823.67,3410.54,7354.20,7194.91,4260.15,5168.18,6334.39,9644.98,11641.34,13114.55,14692.14],
  },
  openingSavings: 2849.95,
};

const formatCF = v => v < 0 ? `-$${Math.abs(Math.round(v)).toLocaleString()}` : `$${Math.round(v).toLocaleString()}`;

// ─── PRESET JANUARY DATA ───
const PRESET_DATA = `Date,Amount,Account Number,,Transaction Type,Transaction Details,Category,Merchant Name,Processed On
30 Jan 26,-45.75,Card ending 7386,,CREDIT CARD PURCHASE,COLES 4545 NORTH LAKE,Groceries,Coles (Westfield North Lakes),30 Jan 26
30 Jan 26,-20.00,Card ending 7386,,CREDIT CARD PURCHASE,CINEPLEX PARTNERSHIP SOUTH BRISBAN,Attractions & events,Cineplex (South Brisbane),30 Jan 26
30 Jan 26,-13.80,Card ending 7386,,CREDIT CARD PURCHASE,BUNNINGS 376000 NORTH LAKES,Home improvements,Bunnings (North Lakes),30 Jan 26
29 Jan 26,-23.43,Card ending 7386,,CREDIT CARD PURCHASE,Yo-Chi Albert Street Brisbane,Restaurants & takeaway,Yo-Chi Frozen Yogurt (Brisbane City),29 Jan 26
29 Jan 26,-20.70,Card ending 7386,,CREDIT CARD PURCHASE,SRI RAMESHWAR PTY LTD BRISBANE,Restaurants & takeaway,Burrito Bar (Southbank),29 Jan 26
29 Jan 26,-15.99,Card ending 7386,,CREDIT CARD PURCHASE,Disney Plus 1800-965160,Subscriptions,Disney Plus,29 Jan 26
29 Jan 26,-59.00,Card ending 7386,,CREDIT CARD PURCHASE,THE LUXURIATE CANDLE AIRPORT WEST,Homeware,The Luxuriate,29 Jan 26
29 Jan 26,-50.14,Card ending 7386,,CREDIT CARD PURCHASE,7-ELEVEN 4220 NORTH LAKES,Groceries,7-Eleven (North Lakes),29 Jan 26
28 Jan 26,-17.48,Card ending 7386,,CREDIT CARD PURCHASE,BUNNINGS 556000 NEWSTEAD,Home improvements,Bunnings (Newstead),28 Jan 26
28 Jan 26,-98.58,Card ending 7386,,CREDIT CARD PURCHASE,BUPA HI PTY LTD MELBOURNE,Insurance,Bupa,28 Jan 26
27 Jan 26,-2.22,Card ending 7386,,CREDIT CARD PURCHASE,BCC ON STREET PARKING BRISBANE CITY,Parking & tolls,Brisbane City Council (Parking),27 Jan 26
27 Jan 26,-43.08,Card ending 7386,,CREDIT CARD PURCHASE,SUSHI JIRO CHERMSIDE CHERMSIDE,Restaurants & takeaway,Sushi Jiro (Westfield Chermside),27 Jan 26
27 Jan 26,-34.65,Card ending 7386,,CREDIT CARD PURCHASE,WWW.BEACHHOUSEBARGRILL WWW.BEACHHOUS,Restaurants & takeaway,Beach House Bar & Grill,27 Jan 26
27 Jan 26,-26.40,Card ending 7386,,CREDIT CARD PURCHASE,WOOLWORTHS/MARKETPLACE DEDECEPTION BAY,Groceries,Woolworths (Deception Bay),27 Jan 26
27 Jan 26,-25.50,Card ending 7386,,CREDIT CARD PURCHASE,Dominos Hamilton,Restaurants & takeaway,Dominos Pizza (Hamilton QLD),27 Jan 26
27 Jan 26,-24.04,Card ending 7386,,CREDIT CARD PURCHASE,ZAMBRERO NORTH LAKES NORTH LAKES,Restaurants & takeaway,Zambrero (North Lakes),27 Jan 26
27 Jan 26,-22.89,Card ending 7386,,CREDIT CARD PURCHASE,ZAMBRERO NORTH LAKES NORTH LAKES,Restaurants & takeaway,Zambrero (North Lakes),27 Jan 26
27 Jan 26,-60.32,Card ending 7386,,CREDIT CARD PURCHASE,BP NEWSTEAD 1421 FORTITUDE VAL,Fuel,BP (Newstead),27 Jan 26
27 Jan 26,-122.83,Card ending 7386,,CREDIT CARD PURCHASE,ALLIANZ AUSTRALIA INSURANSYDNEY,Insurance,Allianz Insurance,27 Jan 26
22 Jan 26,-15.99,Card ending 7386,,CREDIT CARD PURCHASE,APPLE.COM/BILL SYDNEY,Subscriptions,Apple (App Store),22 Jan 26
22 Jan 26,-14.99,Card ending 7386,,CREDIT CARD PURCHASE,APPLE.COM/BILL SYDNEY,Subscriptions,Apple (App Store),22 Jan 26
22 Jan 26,-14.77,Card ending 7386,,CREDIT CARD PURCHASE,Yo-Chi Albert Street Brisbane,Restaurants & takeaway,Yo-Chi Frozen Yogurt (Brisbane City),22 Jan 26
22 Jan 26,-50.45,Card ending 7386,,CREDIT CARD PURCHASE,COL NAYLER TRA NORTH LAKES,Personal care,Col Nayler Barber Shop,22 Jan 26
22 Jan 26,-131.08,Card ending 7386,,CREDIT CARD PURCHASE,TELSTRA SERVICES MELBOURNE,Phone & internet,Telstra,22 Jan 26
20 Jan 26,-18.95,Card ending 7386,,CREDIT CARD PURCHASE,COLES 4545 NORTH LAKE,Groceries,Coles (Westfield North Lakes),20 Jan 26
20 Jan 26,-11.41,Card ending 7386,,CREDIT CARD PURCHASE,SMP*Hero Sushi North L North Lakes,Restaurants & takeaway,Hero Sushi (Westfield North Lakes),20 Jan 26
19 Jan 26,-8.00,Card ending 7386,,CREDIT CARD PURCHASE,Dominos Estore Burpengarydominos.com.a,Restaurants & takeaway,Dominos Pizza (Burpengary),19 Jan 26
19 Jan 26,-4.93,Card ending 7386,,CREDIT CARD PURCHASE,BCC ON STREET PARKING BRISBANE CITY,Parking & tolls,Brisbane City Council (Parking),19 Jan 26
19 Jan 26,-31.70,Card ending 7386,,CREDIT CARD PURCHASE,SUSHI TRAIN MANGO HILL MANGO HILL,Restaurants & takeaway,Sushi Train (Mango Hill),19 Jan 26
19 Jan 26,-18.50,Card ending 7386,,CREDIT CARD PURCHASE,SUSHI TRAIN MANGO HILL MANGO HILL,Restaurants & takeaway,Sushi Train (Mango Hill),19 Jan 26
19 Jan 26,-15.99,Card ending 7386,,CREDIT CARD PURCHASE,Spotify P3E807E445 Sydney,Subscriptions,Spotify,19 Jan 26
16 Jan 26,-5.70,Card ending 7386,,CREDIT CARD PURCHASE,CIRCUM VENDING MENTONE,Electronics & technology,CircumTec,16 Jan 26
16 Jan 26,-20.00,Card ending 7386,,CREDIT CARD PURCHASE,CINEPLEX PARTNERSHIP SOUTH BRISBAN,Attractions & events,Cineplex (South Brisbane),16 Jan 26
16 Jan 26,-10.99,Card ending 7386,,CREDIT CARD PURCHASE,CHEMIST WAREHOUSE FORTITUFORTITUDE VAL,Medical,Chemist Warehouse,16 Jan 26
16 Jan 26,-64.00,Card ending 7386,,CREDIT CARD PURCHASE,ZLR*Kinn Imm Brisbane City,Restaurants & takeaway,Kinn Imm,16 Jan 26
16 Jan 26,-51.03,Card ending 7386,,CREDIT CARD PURCHASE,AMAZON RETA* AMAZON AU SYDNEY,Other shopping,Amazon,16 Jan 26
16 Jan 26,-507.06,Card ending 7386,,CREDIT CARD PURCHASE,UNITYWATER - CABOOLTUR CABOOLTURE,Utilities,Unitywater,16 Jan 26
15 Jan 26,-4.08,Card ending 7386,,CREDIT CARD PURCHASE,NORTH LAKES CAR PARK NORTH LAKES,Parking & tolls,PriPark (North Lakes),15 Jan 26
15 Jan 26,-68.25,Card ending 7386,,CREDIT CARD PURCHASE,COLES 4582 BURPENGARY,Groceries,Coles (Burpengary),15 Jan 26
14 Jan 26,-1.00,Card ending 7386,,CREDIT CARD PURCHASE,TRANSLINK TICKETING QLD,Public transport,Translink,14 Jan 26
14 Jan 26,-17.00,Card ending 7386,,CREDIT CARD PURCHASE,Dominos Estore Burpengarydominos.com.a,Restaurants & takeaway,Dominos Pizza (Burpengary),14 Jan 26
14 Jan 26,-16.00,Card ending 7386,,CREDIT CARD PURCHASE,SUSHI TRAIN MANGO HILL MANGO HILL,Restaurants & takeaway,Sushi Train (Mango Hill),14 Jan 26
14 Jan 26,-70.00,Card ending 7386,,CREDIT CARD PURCHASE,Northlakes Doctors North Lakes,Medical,Northlakes Doctors,14 Jan 26
14 Jan 26,-66.57,Card ending 7386,,CREDIT CARD PURCHASE,AAMI INSURANCE BRISBANE CITY,Insurance,AAMI,14 Jan 26
14 Jan 26,-53.85,Card ending 7386,,CREDIT CARD PURCHASE,AMPOL EAGLE FARM EAGLE FARM,Fuel,Ampol (Eagle Farm),14 Jan 26
12 Jan 26,-9.99,Card ending 7386,,CREDIT CARD PURCHASE,AMZNPRIMEA* AMZNPRIMEA SYDNEY SOUTH,Subscriptions,Amazon Prime Membership,12 Jan 26
12 Jan 26,-9.00,Card ending 7386,,CREDIT CARD PURCHASE,ZLR*Gelatissimo North l north lakes,Restaurants & takeaway,Gelatissimo North Lakes,12 Jan 26
12 Jan 26,-6.50,Card ending 7386,,CREDIT CARD PURCHASE,WOOLWORTHS/76 SKYRING TERNEWSTEAD,Groceries,Woolworths (Newstead),12 Jan 26
12 Jan 26,-6.04,Card ending 7386,,CREDIT CARD PURCHASE,CITYOFGOLDCOASTPARKING BUNDALL,Parking & tolls,Gold Coast City Council (Parking),12 Jan 26
12 Jan 26,-29.90,Card ending 7386,,CREDIT CARD PURCHASE,GRILLD PTY LTD - NORT MANGO HILL,Restaurants & takeaway,Grilld (Westfield North Lakes),12 Jan 26
12 Jan 26,-26.59,Card ending 7386,,CREDIT CARD PURCHASE,Fort Specialty Coffee North Lakes,Cafe & coffee,The Fort Specialty Coffee,12 Jan 26
12 Jan 26,-21.30,Card ending 7386,,CREDIT CARD PURCHASE,GYG Surfers Paradise Surfers Parad,Restaurants & takeaway,Guzman Y Gomez (Surfers Paradise),12 Jan 26
12 Jan 26,-13.24,Card ending 7386,,CREDIT CARD PURCHASE,Yo-Chi Albert Street Brisbane,Restaurants & takeaway,Yo-Chi Frozen Yogurt (Brisbane City),12 Jan 26
12 Jan 26,-144.99,Card ending 7386,,CREDIT CARD PURCHASE,APPLE.COM/BILL SYDNEY,Subscriptions,Apple (App Store),12 Jan 26
09 Jan 26,-20.00,Card ending 7386,,CREDIT CARD PURCHASE,Wara Sushi Gasworks Newstead,Restaurants & takeaway,Wara Sushi (Gasworks),09 Jan 26
09 Jan 26,-40.80,Card ending 7386,,CREDIT CARD PURCHASE,Grilld Pty Ltd Richmond,Restaurants & takeaway,Grilld,09 Jan 26
09 Jan 26,-8.10,Card ending 7386,,CREDIT CARD PURCHASE,PADDLE.NET* FASTMAIL LONDON,Other shopping,Paddle,09 Jan 26
09 Jan 26,-52.76,Card ending 7386,,CREDIT CARD PURCHASE,WOOLWORTHS/76 SKYRING TERNEWSTEAD,Groceries,Woolworths (Newstead),09 Jan 26
09 Jan 26,-0.28,Card ending     ,,FEES,NAB INTNL TRAN FEE - (SC),Fees,,09 Jan 26
08 Jan 26,-32.72,Card ending 7386,,CREDIT CARD PURCHASE,MB.ZZOEY PTY LTD Sunnybank,Uncategorised,,08 Jan 26
08 Jan 26,-48.00,Card ending 7386,,CREDIT CARD PURCHASE,WORLD VISION BURWOOD EAST,Donations,World Vision,08 Jan 26
07 Jan 26,-0.50,Card ending 7386,,CREDIT CARD PURCHASE,TRANSLINK TICKETING QLD,Public transport,Translink,07 Jan 26
05 Jan 26,-19.44,Card ending 7386,,CREDIT CARD PURCHASE,Yo-Chi Gasworks Newstead,Restaurants & takeaway,Yo-Chi Frozen Yogurt (Gasworks),05 Jan 26
05 Jan 26,-19.40,Card ending 7386,,CREDIT CARD PURCHASE,HANE SUSHI DAKABIN PL DAKABIN,Restaurants & takeaway,Hane Sushi (Dakabin),05 Jan 26
05 Jan 26,-15.24,Card ending 7386,,CREDIT CARD PURCHASE,SQ *LITTLE SHANGHAI Hamilton,Restaurants & takeaway,Little Shanghai (Eat Street),05 Jan 26
05 Jan 26,-62.53,Card ending 7386,,CREDIT CARD PURCHASE,BP NEWSTEAD 1421 FORTITUDE VAL,Fuel,BP (Newstead),05 Jan 26
05 Jan 26,-19.29,Card ending 7386,,CREDIT CARD PURCHASE,SAHARA EATS Hamilton,Restaurants & takeaway,Eat Street Northshore,05 Jan 26
05 Jan 26,-28.10,Card ending 7386,,CREDIT CARD PURCHASE,BETTYS BURGERS AUSTRA NEWSTEAD,Restaurants & takeaway,Bettys Burgers (Newstead),05 Jan 26
05 Jan 26,-11.19,Card ending 7386,,CREDIT CARD PURCHASE,Microsoft*Store msbill.info,Electronics & technology,Microsoft,05 Jan 26
05 Jan 26,-39.98,Card ending 7386,,CREDIT CARD PURCHASE,APPLE.COM/BILL SYDNEY,Subscriptions,Apple (App Store),05 Jan 26
05 Jan 26,-10.40,Card ending 7386,,CREDIT CARD PURCHASE,HIERBA SANTA PTY. LTD. MANLY WEST,Groceries,Hierba Santa Organic,05 Jan 26
05 Jan 26,-27.70,Card ending 7386,,CREDIT CARD PURCHASE,Fort Specialty Coffee North Lakes,Cafe & coffee,The Fort Specialty Coffee,05 Jan 26
05 Jan 26,-9.99,Card ending 7386,,CREDIT CARD PURCHASE,NETFLIX.COM Melbourne,Subscriptions,Netflix,05 Jan 26
02 Jan 26,-178.00,Card ending 7386,,CREDIT CARD PURCHASE,SQ *BIG BOY BANGKOK Newstead,Other shopping,Square,02 Jan 26
02 Jan 26,-7.70,Card ending 7386,,CREDIT CARD PURCHASE,The Trustee for CHAMM Brisbane Airp,Restaurants & takeaway,The Trustee for CHAMMA,02 Jan 26
02 Jan 26,-14.69,Card ending 7386,,CREDIT CARD PURCHASE,Yo-Chi Gasworks Newstead,Restaurants & takeaway,Yo-Chi Frozen Yogurt (Gasworks),02 Jan 26
02 Jan 26,-59.25,Card ending 7386,,CREDIT CARD PURCHASE,WOOLWORTHS/VILLAGE CENTREHAMILTON,Groceries,Woolworths (Brisbane Airport),02 Jan 26
02 Jan 26,-35.54,Card ending 7386,,CREDIT CARD PURCHASE,Burrito Bar Portside Hamilton,Restaurants & takeaway,The Burrito Bar (Portside Wharf),02 Jan 26`;

const PRESET_NEXUS = `Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description
"30 Jan 2026","Anytime Fitness","Nexus","Sports & Fitness","Memberships","","","19.95","","3897.92","From Anytime Fitness - A00L8F4W0NLA"
"23 Jan 2026","Anytime Fitness","Nexus","Sports & Fitness","Memberships","","","19.95","","5187.39","From Anytime Fitness - A00L6GV51S0L"
"22 Jan 2026","Online Purchase From Fks Caboolture Pty Ltd Narang","Nexus","Home","Services","","","141.5","","5207.34","Online purchase from FKS CABOOLTURE PTY LTD NARANG"
"21 Jan 2026","Linkt","Nexus","Transportation","Parking & Tolls","","","25","","5348.84","From Linkt Brisbane - 219351617111"
"16 Jan 2026","Anytime Fitness","Nexus","Sports & Fitness","Memberships","","","19.95","","5105.34","From Anytime Fitness - A00L4EAK0NCV"
"09 Jan 2026","Anytime Fitness","Nexus","Sports & Fitness","Memberships","","","19.95","","9483.34","From Anytime Fitness - A00L2B7D00MG"
"02 Jan 2026","Anytime Fitness","Nexus","Sports & Fitness","Memberships","","","19.95","","9453.34","From Anytime Fitness - A00L04Y817FC"`;

const PRESET_EOS = `Transaction Date,Details,Account,Category,Subcategory,Tags,Notes,Debit,Credit,Balance,Original Description
"17 Jan 2026","Purchase At Figma San Franciscoca","Eclipse Operation Services","Technology","Software","","","33.01","","15.85"," FIGMA SAN FRANCISCOCA - USD 22.00"
"14 Jan 2026","From Xeroaustraliapty - Xeroauinv_tmpkbwis","Eclipse Operation Services","Financial","Transfers","","","35","","48.86","From XEROAUSTRALIAPTY - XeroAUINV_TmpKbWiS"
"14 Jan 2026","To Haymans Electrical - 574258-0 Receipt number: ON0000183420375","Eclipse Operation Services","Financial","Transfers","","","86.25","","83.86","To Haymans Electrical - 574258-0"
"14 Jan 2026","Online Purchase From Supabase Singapor","Eclipse Operation Services","Leisure","Music","","","37.48","","70.11","Online purchase from SUPABASE SINGAPOR - USD 25.00"
"13 Jan 2026","ALDIMobile","Eclipse Operation Services","Utilities","Phone","","","23","","107.59","Online purchase from MED*ALDIMobile CHATSWOOD AU"
"13 Jan 2026","Microsoft","Eclipse Operation Services","Technology","Hardware","","","8.21","","30.59"," Microsoft-G134995879 Sydney AU"
"12 Jan 2026","From Xeroaustraliapty - Xeroauinv_tmgwcaxt","Eclipse Operation Services","Financial","Transfers","","","35","","3.8","From XEROAUSTRALIAPTY - XeroAUINV_TmGwCAxt"
"10 Jan 2026","Microsoft","Eclipse Operation Services","Technology","Hardware","","","8.8","","38.8"," Microsoft-G133779358 Sydney AU"
"08 Jan 2026","Purchase At Claude.ai Subscription Sa","Eclipse Operation Services","Leisure","Music","","","186.15","","47.6"," CLAUDE.AI SUBSCRIPTION SA - AUD 186.15"
"05 Jan 2026","Purchase At Claude.ai Subscription Sa","Eclipse Operation Services","Leisure","Music","","","169.99","","233.75"," CLAUDE.AI SUBSCRIPTION SA - AUD 169.99"
"03 Jan 2026","Adobe","Eclipse Operation Services","Technology","Hardware","","","96.99","","403.74"," Adobe Sydney AU"
"02 Jan 2026","Purchase At Google Workspace_eop.s Sydney Au","Eclipse Operation Services","Technology","Online Services","","","9.21","","500.73"," Google Workspace_eop.s Sydney AU"
"01 Jan 2026","Purchase At Paddle.net* N8n Cloud1 Lon","Eclipse Operation Services","Technology","Online Services","","","46.52","","509.94"," PADDLE.NET* N8N CLOUD1 Lon - EUR 26.40"`;

// ─── COLORS ───
const COLORS = {
  bg: "#0a0f1a",
  card: "#111827",
  cardAlt: "#0d1321",
  cardHover: "#1a2234",
  border: "#1e293b",
  text: "#e2e8f0",
  textDim: "#64748b",
  accent: "#22d3ee",
  accentDim: "#0e7490",
  green: "#34d399",
  greenDim: "#065f46",
  red: "#f87171",
  redDim: "#991b1b",
  amber: "#fbbf24",
  amberDim: "#92400e",
  purple: "#a78bfa",
  blue: "#60a5fa",
  pink: "#f472b6",
};

const PIE_COLORS = ["#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#f472b6", "#60a5fa", "#fb923c", "#4ade80", "#e879f9", "#38bdf8", "#facc15"];

// ─── MAIN APP ───
export default function FinanceDashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [transactions, setTransactions] = useState([]);
  const [savingsGoals, setSavingsGoals] = useState([
    { id: 1, name: "Emergency Fund", target: 5000, current: 2850, color: "#22d3ee" },
    { id: 2, name: "Loop Linen Launch", target: 10000, current: 0, color: "#a78bfa" },
    { id: 3, name: "Car Loan Payoff", target: 3471, current: 0, color: "#34d399" },
  ]);
  const [newGoalName, setNewGoalName] = useState("");
  const [newGoalTarget, setNewGoalTarget] = useState("");
  const [balances, setBalances] = useState({
    "Credit Card": { expected: 0, actual: "" },
    "Nexus": { expected: 3897.92, actual: "" },
    "Eclipse Operation Services": { expected: 456.07, actual: "" },
    "EOP Services - Property": { expected: 1346.30, actual: "" },
  });

  useEffect(() => {
    const cc = parseCreditCardCSV(PRESET_DATA);
    const nexus = parseBankCSV(PRESET_NEXUS);
    const eos = parseBankCSV(PRESET_EOS);
    setTransactions([...cc, ...nexus, ...eos]);
  }, []);

  const handleFileUpload = useCallback((e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const parsed = detectAndParseCSV(ev.target.result);
        setTransactions(prev => {
          const existingKeys = new Set(prev.map(t => `${t.date}-${t.amount}-${t.details}`));
          const newTxns = parsed.filter(t => !existingKeys.has(`${t.date}-${t.amount}-${t.details}`));
          return [...prev, ...newTxns];
        });
      };
      reader.readAsText(file);
    });
    e.target.value = "";
  }, []);

  const expenses = useMemo(() => transactions.filter(t => t.isExpense), [transactions]);
  const income = useMemo(() => transactions.filter(t => !t.isExpense), [transactions]);

  const categoryTotals = useMemo(() => {
    const map = {};
    expenses.forEach(t => {
      if (!map[t.category]) map[t.category] = { total: 0, count: 0, items: [] };
      map[t.category].total += t.amount;
      map[t.category].count += 1;
      map[t.category].items.push(t);
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [expenses]);

  const totalExpenses = useMemo(() => expenses.reduce((s, t) => s + t.amount, 0), [expenses]);
  const totalIncome = useMemo(() => {
    const wages = 2100;
    const rent = 2925;
    const other = 960;
    return wages + rent + other;
  }, []);
  const netIncome = totalIncome - totalExpenses;

  const budgetComparison = useMemo(() => {
    const catMap = {};
    expenses.forEach(t => {
      if (!catMap[t.category]) catMap[t.category] = 0;
      catMap[t.category] += t.amount;
    });
    return Object.entries(BUDGET.expenses).map(([cat, data]) => {
      const actual = catMap[cat] || 0;
      const budget = data.budget || 0;
      return { category: cat, budget, actual, diff: budget - actual, pct: budget > 0 ? (actual / budget) * 100 : 0 };
    }).filter(b => b.budget > 0 || b.actual > 0);
  }, [expenses]);

  const dailySpending = useMemo(() => {
    const map = {};
    expenses.forEach(t => {
      const key = t.date instanceof Date ? t.date.toISOString().slice(0, 10) : t.date;
      if (!map[key]) map[key] = 0;
      map[key] += t.amount;
    });
    return Object.entries(map).sort().map(([date, total]) => ({ date: date.slice(5), total: Math.round(total * 100) / 100 }));
  }, [expenses]);

  const weeklyPattern = useMemo(() => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const map = days.map(d => ({ day: d, total: 0, count: 0 }));
    expenses.forEach(t => {
      const d = t.date instanceof Date ? t.date.getDay() : new Date(t.date).getDay();
      map[d].total += t.amount;
      map[d].count += 1;
    });
    return map.map(d => ({ ...d, avg: d.count > 0 ? Math.round(d.total / Math.max(d.count / 4, 1)) : 0 }));
  }, [expenses]);

  const topMerchants = useMemo(() => {
    const map = {};
    expenses.forEach(t => {
      const name = t.details || "Unknown";
      if (!map[name]) map[name] = { total: 0, count: 0, category: t.category };
      map[name].total += t.amount;
      map[name].count += 1;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total).slice(0, 12);
  }, [expenses]);

  const tabs = [
    { id: "cashflow", label: "Cash Flow", icon: "⟳" },
    { id: "dashboard", label: "Dashboard", icon: "◉" },
    { id: "transactions", label: "Transactions", icon: "≡" },
    { id: "budget", label: "Budget", icon: "▤" },
    { id: "goals", label: "Goals", icon: "◎" },
    { id: "insights", label: "Insights", icon: "✦" },
    { id: "reconcile", label: "Reconcile", icon: "✓" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)", borderBottom: `1px solid ${COLORS.border}`, padding: "20px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 3, color: COLORS.accent, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Eclipse Operation Services</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, background: "linear-gradient(135deg, #e2e8f0, #22d3ee)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Financial Command Centre</h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: COLORS.accent + "18", border: `1px solid ${COLORS.accent}40`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, color: COLORS.accent, transition: "all 0.2s" }}>
              <span>＋ Import CSV</span>
              <input type="file" multiple accept=".csv" onChange={handleFileUpload} style={{ display: "none" }} />
            </label>
            <button onClick={() => supabase.auth.signOut()} style={{
              padding: "8px 16px", background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 8,
              color: COLORS.textDim, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
            }}>Sign Out</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: COLORS.card, borderBottom: `1px solid ${COLORS.border}`, position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", gap: 0, overflowX: "auto", padding: "0 24px" }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: "14px 18px", border: "none", background: "none", color: activeTab === tab.id ? COLORS.accent : COLORS.textDim,
              fontSize: 13, fontWeight: 500, cursor: "pointer", borderBottom: activeTab === tab.id ? `2px solid ${COLORS.accent}` : "2px solid transparent",
              transition: "all 0.2s", whiteSpace: "nowrap", fontFamily: "inherit",
            }}>
              <span style={{ marginRight: 6 }}>{tab.icon}</span>{tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px" }}>
        {activeTab === "cashflow" && <CashFlowTab />}
        {activeTab === "dashboard" && <DashboardTab
          totalIncome={totalIncome} totalExpenses={totalExpenses} netIncome={netIncome}
          categoryTotals={categoryTotals} dailySpending={dailySpending} budgetComparison={budgetComparison}
          transactions={transactions} expenses={expenses}
        />}
        {activeTab === "transactions" && <TransactionsTab transactions={transactions} setTransactions={setTransactions} />}
        {activeTab === "budget" && <BudgetTab budgetComparison={budgetComparison} totalExpenses={totalExpenses} />}
        {activeTab === "goals" && <GoalsTab goals={savingsGoals} setGoals={setSavingsGoals} netIncome={netIncome}
          newGoalName={newGoalName} setNewGoalName={setNewGoalName} newGoalTarget={newGoalTarget} setNewGoalTarget={setNewGoalTarget} />}
        {activeTab === "insights" && <InsightsTab categoryTotals={categoryTotals} topMerchants={topMerchants} weeklyPattern={weeklyPattern} expenses={expenses} totalExpenses={totalExpenses} />}
        {activeTab === "reconcile" && <ReconcileTab balances={balances} setBalances={setBalances} />}
      </div>
    </div>
  );
}

// ─── METRIC CARD ───
function MetricCard({ label, value, subtitle, color = COLORS.accent, icon }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "20px", flex: "1 1 200px", minWidth: 180 }}>
      <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8, fontWeight: 500 }}>{icon && <span style={{ marginRight: 6 }}>{icon}</span>}{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      {subtitle && <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

// ─── DASHBOARD ───
function DashboardTab({ totalIncome, totalExpenses, netIncome, categoryTotals, dailySpending, budgetComparison, expenses }) {
  const pieData = categoryTotals.slice(0, 8).map(([name, data]) => ({ name, value: Math.round(data.total) }));
  const budgetOverspend = budgetComparison.filter(b => b.pct > 100);
  const eatingOut = categoryTotals.find(([c]) => c === "Restaurants & Takeaway");
  const eatingTotal = eatingOut ? eatingOut[1].total : 0;
  const cafeTotal = categoryTotals.find(([c]) => c === "Cafe & Coffee")?.[1]?.total || 0;
  const foodOutTotal = eatingTotal + cafeTotal;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Top Metrics */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <MetricCard label="Income" value={`$${totalIncome.toLocaleString()}`} subtitle="Jan 2026 budget" color={COLORS.green} icon="↓" />
        <MetricCard label="Expenses" value={`$${Math.round(totalExpenses).toLocaleString()}`} subtitle={`${expenses.length} transactions`} color={COLORS.red} icon="↑" />
        <MetricCard label="Net" value={`${netIncome >= 0 ? "+" : ""}$${Math.round(netIncome).toLocaleString()}`} subtitle={netIncome >= 0 ? "Under budget ✓" : "Over budget ✗"} color={netIncome >= 0 ? COLORS.green : COLORS.red} icon="≈" />
        <MetricCard label="Food & Dining" value={`$${Math.round(foodOutTotal)}`} subtitle={`${eatingOut ? eatingOut[1].count : 0} meals out`} color={COLORS.amber} icon="🍜" />
      </div>

      {/* Alert Banner */}
      {budgetOverspend.length > 0 && (
        <div style={{ background: COLORS.redDim + "40", border: `1px solid ${COLORS.red}30`, borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontWeight: 600, color: COLORS.red, marginBottom: 6, fontSize: 14 }}>⚠ Budget Alerts</div>
          <div style={{ fontSize: 13, color: COLORS.text, lineHeight: 1.7 }}>
            {budgetOverspend.map(b => (
              <div key={b.category}>
                <span style={{ color: COLORS.red, fontFamily: "'JetBrains Mono', monospace" }}>{b.category}</span>
                {" "} — ${Math.round(b.actual)} spent vs ${Math.round(b.budget)} budget ({Math.round(b.pct)}%)
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {/* Spending by Category */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20, flex: "1 1 400px", minWidth: 320 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Spending by Category</div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none">
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1, minWidth: 140 }}>
              {pieData.map((item, i) => (
                <div key={item.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: PIE_COLORS[i] }} />
                    <span style={{ color: COLORS.textDim }}>{item.name}</span>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>${item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Daily Spending */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20, flex: "1 1 400px", minWidth: 320 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Daily Spending</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={dailySpending}>
              <defs>
                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="date" tick={{ fill: COLORS.textDim, fontSize: 10 }} axisLine={false} />
              <YAxis tick={{ fill: COLORS.textDim, fontSize: 10 }} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} formatter={v => [`$${v}`, "Spent"]} />
              <Area type="monotone" dataKey="total" stroke={COLORS.accent} fill="url(#spendGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Budget vs Actual Quick View */}
      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Budget vs Actual — January 2026</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={budgetComparison.filter(b => b.budget > 0)} layout="vertical" margin={{ left: 100 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} horizontal={false} />
            <XAxis type="number" tick={{ fill: COLORS.textDim, fontSize: 10 }} tickFormatter={v => `$${v}`} />
            <YAxis type="category" dataKey="category" tick={{ fill: COLORS.textDim, fontSize: 11 }} width={95} />
            <Tooltip contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} formatter={v => `$${Math.round(v)}`} />
            <Bar dataKey="budget" fill={COLORS.accent + "40"} radius={[0, 4, 4, 0]} name="Budget" />
            <Bar dataKey="actual" fill={COLORS.accent} radius={[0, 4, 4, 0]} name="Actual" />
            <Legend wrapperStyle={{ fontSize: 11, color: COLORS.textDim }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── TRANSACTIONS ───
function TransactionsTab({ transactions, setTransactions }) {
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);

  const categories = useMemo(() => {
    const set = new Set(transactions.map(t => t.category));
    return ["all", ...Array.from(set).sort()];
  }, [transactions]);

  const filtered = useMemo(() => {
    return transactions
      .filter(t => {
        if (catFilter !== "all" && t.category !== catFilter) return false;
        if (filter && !t.details.toLowerCase().includes(filter.toLowerCase()) && !t.category.toLowerCase().includes(filter.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => (b.date instanceof Date ? b.date : new Date(b.date)) - (a.date instanceof Date ? a.date : new Date(a.date)));
  }, [transactions, filter, catFilter]);

  const updateCategory = (idx, newCat) => {
    setTransactions(prev => prev.map((t, i) => {
      if (t === filtered[idx]) return { ...t, category: newCat };
      return t;
    }));
    setEditingId(null);
  };

  const allCatOptions = ["Groceries", "Fuel", "Restaurants & Takeaway", "Cafe & Coffee", "Subscriptions", "Health Insurance", "Car Insurance", "House Insurance", "Car Loan", "Health & Fitness", "Mobile", "EOP Software", "Eclipse Utilities", "Mortgage", "General", "Entertainment", "Medical", "Donations", "Personal Care", "Shopping", "Home Improvements", "Transport & Parking", "Public Transport"];

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search transactions..." style={{
          flex: "1 1 200px", padding: "10px 14px", background: COLORS.card, border: `1px solid ${COLORS.border}`,
          borderRadius: 8, color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none",
        }} />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{
          padding: "10px 14px", background: COLORS.card, border: `1px solid ${COLORS.border}`,
          borderRadius: 8, color: COLORS.text, fontSize: 13, fontFamily: "inherit",
        }}>
          {categories.map(c => <option key={c} value={c}>{c === "all" ? "All Categories" : c}</option>)}
        </select>
      </div>

      <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 12 }}>{filtered.length} transactions • Click category to re-assign</div>

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                {["Date", "Description", "Category", "Account", "Amount"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: COLORS.textDim, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((t, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}08` }}>
                  <td style={{ padding: "10px 16px", color: COLORS.textDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                    {t.date instanceof Date ? t.date.toLocaleDateString("en-AU", { day: "2-digit", month: "short" }) : t.date}
                  </td>
                  <td style={{ padding: "10px 16px", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.details}</td>
                  <td style={{ padding: "10px 16px" }}>
                    {editingId === i ? (
                      <select autoFocus value={t.category} onChange={e => updateCategory(i, e.target.value)} onBlur={() => setEditingId(null)}
                        style={{ padding: "4px 8px", background: COLORS.bg, border: `1px solid ${COLORS.accent}`, borderRadius: 6, color: COLORS.text, fontSize: 12, fontFamily: "inherit" }}>
                        {allCatOptions.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <span onClick={() => setEditingId(i)} style={{ padding: "3px 10px", background: COLORS.accent + "15", color: COLORS.accent, borderRadius: 20, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {t.category}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px 16px", color: COLORS.textDim, fontSize: 11 }}>{t.account}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: t.isExpense ? COLORS.red : COLORS.green }}>
                    {t.isExpense ? "-" : "+"}${t.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── BUDGET ───
function BudgetTab({ budgetComparison, totalExpenses }) {
  const totalBudget = budgetComparison.reduce((s, b) => s + b.budget, 0);
  const unbudgeted = totalExpenses - budgetComparison.reduce((s, b) => s + b.actual, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <MetricCard label="Total Budget" value={`$${Math.round(totalBudget).toLocaleString()}`} color={COLORS.accent} icon="▤" />
        <MetricCard label="Total Actual" value={`$${Math.round(totalExpenses).toLocaleString()}`} color={totalExpenses > totalBudget ? COLORS.red : COLORS.green} icon="≡" />
        {unbudgeted > 10 && <MetricCard label="Unbudgeted Spend" value={`$${Math.round(unbudgeted)}`} subtitle="Not in any category" color={COLORS.amber} icon="?" />}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {budgetComparison.map(b => {
          const pct = b.budget > 0 ? Math.min((b.actual / b.budget) * 100, 150) : 100;
          const over = b.actual > b.budget && b.budget > 0;
          const barColor = over ? COLORS.red : pct > 80 ? COLORS.amber : COLORS.green;

          return (
            <div key={b.category} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{b.category}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                  <span style={{ color: COLORS.textDim }}>Budget: ${Math.round(b.budget)}</span>
                  <span style={{ color: barColor, fontWeight: 600 }}>Actual: ${Math.round(b.actual)}</span>
                  <span style={{ color: over ? COLORS.red : COLORS.green, fontWeight: 600 }}>
                    {over ? `+$${Math.round(b.actual - b.budget)} over` : `$${Math.round(b.budget - b.actual)} left`}
                  </span>
                </div>
              </div>
              <div style={{ height: 6, background: COLORS.border, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: barColor, borderRadius: 3, transition: "width 0.6s ease" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Unbudgeted categories */}
      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Spending Outside Budget Categories</div>
        <div style={{ fontSize: 13, color: COLORS.textDim, lineHeight: 1.8 }}>
          These are categories where you spent money that don't have a dedicated budget line. Consider adding budget lines for recurring ones, or folding them into "General".
        </div>
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {["Restaurants & Takeaway", "Cafe & Coffee", "Entertainment", "Medical", "Donations", "Personal Care", "Shopping", "Home Improvements", "Transport & Parking", "Public Transport"].map(cat => {
            const found = budgetComparison.find(b => b.category === cat);
            if (found && found.actual > 0 && found.budget === 0) return null;
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

// ─── GOALS ───
function GoalsTab({ goals, setGoals, netIncome, newGoalName, setNewGoalName, newGoalTarget, setNewGoalTarget }) {
  const addGoal = () => {
    if (!newGoalName || !newGoalTarget) return;
    setGoals(prev => [...prev, { id: Date.now(), name: newGoalName, target: parseFloat(newGoalTarget), current: 0, color: PIE_COLORS[prev.length % PIE_COLORS.length] }]);
    setNewGoalName("");
    setNewGoalTarget("");
  };

  const updateGoalCurrent = (id, amount) => {
    setGoals(prev => prev.map(g => g.id === id ? { ...g, current: Math.max(0, g.current + amount) } : g));
  };

  const removeGoal = (id) => {
    setGoals(prev => prev.filter(g => g.id !== id));
  };

  const totalNeeded = goals.reduce((s, g) => s + Math.max(0, g.target - g.current), 0);
  const monthsToComplete = netIncome > 0 ? Math.ceil(totalNeeded / netIncome) : Infinity;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <MetricCard label="Monthly Surplus" value={`$${Math.round(Math.max(0, netIncome))}`} subtitle="Available for goals" color={COLORS.green} icon="↓" />
        <MetricCard label="Total Remaining" value={`$${Math.round(totalNeeded).toLocaleString()}`} subtitle={monthsToComplete < Infinity ? `~${monthsToComplete} months at current rate` : "No surplus to allocate"} color={COLORS.accent} icon="◎" />
      </div>

      {/* Goal Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {goals.map(goal => {
          const pct = Math.min((goal.current / goal.target) * 100, 100);
          const remaining = Math.max(0, goal.target - goal.current);

          return (
            <div key={goal.id} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{goal.name}</div>
                  <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>
                    ${goal.current.toLocaleString()} of ${goal.target.toLocaleString()} • {Math.round(pct)}% complete
                    {remaining > 0 && netIncome > 0 && ` • ~${Math.ceil(remaining / netIncome)} months`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => updateGoalCurrent(goal.id, 100)} style={{ padding: "6px 12px", background: COLORS.green + "20", border: `1px solid ${COLORS.green}40`, borderRadius: 6, color: COLORS.green, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>+$100</button>
                  <button onClick={() => updateGoalCurrent(goal.id, -100)} style={{ padding: "6px 12px", background: COLORS.red + "20", border: `1px solid ${COLORS.red}40`, borderRadius: 6, color: COLORS.red, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>-$100</button>
                  <button onClick={() => removeGoal(goal.id)} style={{ padding: "6px 12px", background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.textDim, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>✕</button>
                </div>
              </div>
              <div style={{ height: 8, background: COLORS.border, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${goal.color}, ${goal.color}cc)`, borderRadius: 4, transition: "width 0.6s ease" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Goal */}
      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Add New Goal</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input value={newGoalName} onChange={e => setNewGoalName(e.target.value)} placeholder="Goal name" style={{
            flex: "1 1 200px", padding: "10px 14px", background: COLORS.bg, border: `1px solid ${COLORS.border}`,
            borderRadius: 8, color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none",
          }} />
          <input value={newGoalTarget} onChange={e => setNewGoalTarget(e.target.value)} placeholder="Target $" type="number" style={{
            width: 140, padding: "10px 14px", background: COLORS.bg, border: `1px solid ${COLORS.border}`,
            borderRadius: 8, color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none",
          }} />
          <button onClick={addGoal} style={{
            padding: "10px 24px", background: COLORS.accent, border: "none", borderRadius: 8,
            color: COLORS.bg, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}>Add Goal</button>
        </div>
      </div>

      {/* Tips */}
      <div style={{ background: COLORS.accentDim + "30", border: `1px solid ${COLORS.accent}25`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.accent, marginBottom: 8 }}>💡 Goal Strategy</div>
        <div style={{ fontSize: 13, lineHeight: 1.8, color: COLORS.text }}>
          With your current January surplus of ~${Math.round(Math.max(0, netIncome))}, here's a suggested allocation:
          <div style={{ marginTop: 8 }}>
            <strong>50%</strong> → Emergency Fund (until $5k reached)<br />
            <strong>30%</strong> → Car Loan extra payments (saves interest)<br />
            <strong>20%</strong> → Loop Linen launch fund<br />
          </div>
          <div style={{ marginTop: 8, color: COLORS.textDim }}>
            Reducing eating out by 50% would free up ~$360/month extra for goals.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── INSIGHTS ───
function InsightsTab({ categoryTotals, topMerchants, weeklyPattern, expenses, totalExpenses }) {
  const eatingOut = categoryTotals.find(([c]) => c === "Restaurants & Takeaway");
  const cafeOut = categoryTotals.find(([c]) => c === "Cafe & Coffee");
  const foodTotal = (eatingOut?.[1]?.total || 0) + (cafeOut?.[1]?.total || 0);
  const subsTotal = categoryTotals.find(([c]) => c === "Subscriptions")?.[1]?.total || 0;
  const eosTotal = categoryTotals.find(([c]) => c === "EOP Software")?.[1]?.total || 0;

  const insights = [
    {
      icon: "🍜",
      title: "Eating Out: $" + Math.round(foodTotal) + "/month",
      severity: "high",
      detail: `${eatingOut?.[1]?.count || 0} restaurant/takeaway visits plus ${cafeOut?.[1]?.count || 0} cafe visits. That's nearly every day. At current rate, that's $${Math.round(foodTotal * 12).toLocaleString()}/year. Cutting to 2-3x per week could save $300-400/month.`,
      saving: "$300-400/mo",
    },
    {
      icon: "📱",
      title: `Apple Subscriptions: $${Math.round(215.96)}/month`,
      severity: "medium",
      detail: "You have 4 separate Apple charges ($144.99 + $39.98 + $15.99 + $14.99). This likely includes iCloud, Apple Music, Apple TV+, and potentially Apple One. Review whether you're using all services — an Apple One bundle might save money.",
      saving: "$50-80/mo",
    },
    {
      icon: "🤖",
      title: `Dual Claude Charges: $356.14 in January`,
      severity: "high",
      detail: "Two Claude.ai charges — $186.15 and $169.99. This looks like an overlap from upgrading plans. Check with Anthropic support if you were double-billed during a plan change.",
      saving: "$170 one-off",
    },
    {
      icon: "💻",
      title: `EOS Software Stack: $${Math.round(eosTotal)}/month`,
      severity: "medium",
      detail: "Claude Max ($186), Adobe ($97), n8n ($47), Supabase ($37), Xero ($35), Figma ($33), Microsoft ($17), Google Workspace ($9). For a pre-revenue solo operation, consider whether you need all of these simultaneously. Could Adobe be replaced with Figma for design work?",
      saving: "$50-100/mo",
    },
    {
      icon: "🍦",
      title: "Yo-Chi Habit: $86 in January",
      severity: "low",
      detail: "5 visits to Yo-Chi across the month — Brisbane City, Gasworks, and Albert Street locations. Small individually but adds up to ~$1,000/year.",
      saving: "$50/mo",
    },
    {
      icon: "🍕",
      title: "Sushi & Fast Food Pattern",
      severity: "low",
      detail: "Sushi Train, Sushi Jiro, Hero Sushi, Hane Sushi, Wara Sushi — plus Domino's 3x, Zambrero 2x, Grill'd 2x. Meal prepping even 2-3 times a week could significantly reduce this.",
      saving: "$200/mo",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Potential Savings Banner */}
      <div style={{ background: "linear-gradient(135deg, #065f46 0%, #0e7490 100%)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 13, color: COLORS.green, fontWeight: 600, marginBottom: 4 }}>POTENTIAL MONTHLY SAVINGS</div>
        <div style={{ fontSize: 36, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>$670 – $1,000</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>Based on the insights below, without major lifestyle changes</div>
      </div>

      {/* Insight Cards */}
      {insights.map((insight, i) => (
        <div key={i} style={{
          background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20,
          borderLeft: `3px solid ${insight.severity === "high" ? COLORS.red : insight.severity === "medium" ? COLORS.amber : COLORS.accent}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
                <span style={{ marginRight: 8 }}>{insight.icon}</span>{insight.title}
              </div>
              <div style={{ fontSize: 13, color: COLORS.textDim, lineHeight: 1.7 }}>{insight.detail}</div>
            </div>
            <div style={{ padding: "6px 12px", background: COLORS.green + "20", border: `1px solid ${COLORS.green}30`, borderRadius: 8, color: COLORS.green, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", marginLeft: 16 }}>
              Save {insight.saving}
            </div>
          </div>
        </div>
      ))}

      {/* Top Merchants */}
      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Top Merchants by Spend</div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={topMerchants.slice(0, 10).map(([name, d]) => ({ name: name.length > 20 ? name.slice(0, 18) + "…" : name, total: Math.round(d.total * 100) / 100 }))} layout="vertical" margin={{ left: 120 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} horizontal={false} />
            <XAxis type="number" tick={{ fill: COLORS.textDim, fontSize: 10 }} tickFormatter={v => `$${v}`} />
            <YAxis type="category" dataKey="name" tick={{ fill: COLORS.textDim, fontSize: 11 }} width={115} />
            <Tooltip contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} formatter={v => `$${v}`} />
            <Bar dataKey="total" fill={COLORS.accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly Pattern */}
      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Spending by Day of Week</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={weeklyPattern}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="day" tick={{ fill: COLORS.textDim, fontSize: 11 }} />
            <YAxis tick={{ fill: COLORS.textDim, fontSize: 10 }} tickFormatter={v => `$${v}`} />
            <Tooltip contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} formatter={v => `$${v}`} />
            <Bar dataKey="total" fill={COLORS.purple} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── RECONCILE ───
function ReconcileTab({ balances, setBalances }) {
  const updateActual = (account, value) => {
    setBalances(prev => ({ ...prev, [account]: { ...prev[account], actual: value } }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: COLORS.accentDim + "30", border: `1px solid ${COLORS.accent}25`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.accent, marginBottom: 8 }}>Balance Reconciliation</div>
        <div style={{ fontSize: 13, color: COLORS.textDim, lineHeight: 1.7 }}>
          Enter your actual bank balances below to compare against what the transaction data shows. Discrepancies may indicate missing transactions, pending charges, or data import issues.
        </div>
      </div>

      {Object.entries(balances).map(([account, data]) => {
        const actual = parseFloat(data.actual);
        const diff = !isNaN(actual) ? actual - data.expected : null;
        const match = diff !== null && Math.abs(diff) < 1;

        return (
          <div key={account} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{account}</div>
            <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Expected (from CSV)</div>
                <div style={{ fontSize: 20, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>${data.expected.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Actual Balance</div>
                <input value={data.actual} onChange={e => updateActual(account, e.target.value)} placeholder="Enter balance" style={{
                  padding: "8px 14px", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                  color: COLORS.text, fontSize: 18, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", width: 160, outline: "none",
                }} />
              </div>
              {diff !== null && (
                <div>
                  <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Difference</div>
                  <div style={{ fontSize: 20, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: match ? COLORS.green : COLORS.red }}>
                    {match ? "✓ Match" : `${diff > 0 ? "+" : ""}$${diff.toFixed(2)}`}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Tips for Reconciliation</div>
        <div style={{ fontSize: 13, color: COLORS.textDim, lineHeight: 1.8 }}>
          • Check for pending transactions that haven't cleared yet<br />
          • Credit card balance shown is the last balance from your statement CSV<br />
          • Internal transfers between accounts are excluded from expense totals<br />
          • Interest accruals may cause small discrepancies on savings accounts<br />
          • The "expected" balance comes from the most recent balance shown in your CSV export
        </div>
      </div>
    </div>
  );
}

// ─── CASH FLOW ───
function CashFlowTab() {
  const [expanded, setExpanded] = useState({ income: true, expenses: true });
  const [hCol, setHCol] = useState(null);
  const d = CF;
  const annualIncome = d.totals.income.reduce((s, v) => s + v, 0);
  const annualExpenses = d.totals.expenses.reduce((s, v) => s + v, 0);
  const annualNet = annualIncome - annualExpenses;

  const chartData = CF_MONTHS.map((m, i) => ({ month: m, income: Math.round(d.totals.income[i]), expenses: Math.round(d.totals.expenses[i]), net: Math.round(d.totals.net[i]), savings: Math.round(d.totals.savings[i]) }));

  const cellStyle = (i) => ({ padding: "8px 12px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 500, color: COLORS.text, background: i === CF_CUR_MONTH ? COLORS.accent + "08" : hCol === i ? "#ffffff06" : "transparent", borderRight: `1px solid ${COLORS.border}08`, opacity: CF_ACTUAL_MONTHS.includes(i) ? 1 : 0.55, whiteSpace: "nowrap" });
  const totalStyle = (i, color) => ({ ...cellStyle(i), fontWeight: 700, color, fontSize: 13, opacity: 1 });
  const headerCell = (i) => ({ padding: "10px 12px", textAlign: "right", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, color: i === CF_CUR_MONTH ? COLORS.accent : COLORS.textDim, background: i === CF_CUR_MONTH ? COLORS.accent + "08" : "transparent", cursor: "pointer", textTransform: "uppercase", borderBottom: i === CF_CUR_MONTH ? `2px solid ${COLORS.accent}` : "2px solid transparent", whiteSpace: "nowrap" });
  const labelCell = { padding: "8px 16px", fontSize: 13, color: COLORS.text, whiteSpace: "nowrap", position: "sticky", left: 0, background: COLORS.card, zIndex: 2, borderRight: `1px solid ${COLORS.border}` };
  const sectionLabel = { ...labelCell, fontWeight: 700, fontSize: 13, cursor: "pointer", color: COLORS.accent };
  const totalLabel = { ...labelCell, fontWeight: 700, fontSize: 14 };
  const annualCell = (isAmt = true) => ({ padding: "8px 12px", textAlign: "right", fontFamily: isAmt ? "'JetBrains Mono', monospace" : "inherit", fontSize: 12, fontWeight: 600, color: COLORS.textDim, background: COLORS.cardAlt, whiteSpace: "nowrap" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <MetricCard label="FY Annual Income" value={formatCF(annualIncome)} subtitle="Jul 25 – Jun 26" color={COLORS.green} icon="↓" />
        <MetricCard label="FY Annual Expenses" value={formatCF(annualExpenses)} subtitle="All categories" color={COLORS.red} icon="↑" />
        <MetricCard label="FY Net Position" value={`${annualNet >= 0 ? "+" : ""}${formatCF(annualNet)}`} color={annualNet >= 0 ? COLORS.green : COLORS.red} icon="≈" />
        <MetricCard label="Projected Savings" value={formatCF(d.totals.savings[11])} subtitle={`From $${d.openingSavings.toLocaleString()} opening`} color={COLORS.accent} icon="◎" />
      </div>

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>12-Month Cash Flow Overview</div>
        <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 16 }}>Bars = income & expenses • Line = net position</div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="month" tick={{ fill: COLORS.textDim, fontSize: 11 }} />
            <YAxis tick={{ fill: COLORS.textDim, fontSize: 10 }} tickFormatter={v => v > 999 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
            <Tooltip contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, n) => [formatCF(v), n]} />
            <Bar dataKey="income" fill={COLORS.green} radius={[3, 3, 0, 0]} name="Income" opacity={0.8} />
            <Bar dataKey="expenses" fill={COLORS.red} radius={[3, 3, 0, 0]} name="Expenses" opacity={0.6} />
            <Line type="monotone" dataKey="net" stroke={COLORS.accent} strokeWidth={2} dot={{ fill: COLORS.accent, r: 3 }} name="Net" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Cumulative Savings Trajectory</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={[{ month: "Opening", savings: d.openingSavings }, ...chartData.map(c => ({ month: c.month, savings: c.savings }))]} margin={{ left: 10 }}>
            <defs><linearGradient id="savingsGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.3} /><stop offset="95%" stopColor={COLORS.accent} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="month" tick={{ fill: COLORS.textDim, fontSize: 10 }} />
            <YAxis tick={{ fill: COLORS.textDim, fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
            <Tooltip contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} formatter={v => [formatCF(v), "Savings"]} />
            <Area type="monotone" dataKey="savings" stroke={COLORS.accent} fill="url(#savingsGrad)" strokeWidth={2} dot={{ fill: COLORS.accent, r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 12, color: COLORS.textDim, alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS.text, display: "inline-block" }} /> Actual</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS.text, opacity: 0.4, display: "inline-block" }} /> Projected</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS.accent + "30", display: "inline-block" }} /> Current Month</span>
      </div>

      {/* Cash Flow Table */}
      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead><tr style={{ borderBottom: `2px solid ${COLORS.border}` }}>
              <th style={{ ...labelCell, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: COLORS.textDim }}>FY2025-26</th>
              {CF_MONTHS.map((m, i) => <th key={m} style={headerCell(i)} onMouseEnter={() => setHCol(i)} onMouseLeave={() => setHCol(null)}>{m}</th>)}
              <th style={{ ...annualCell(false), fontWeight: 700, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" }}>Annual</th>
            </tr></thead>
            <tbody>
              {/* INCOME */}
              <tr style={{ borderBottom: `1px solid ${COLORS.border}20` }} onClick={() => setExpanded(p => ({ ...p, income: !p.income }))}>
                <td style={sectionLabel}>{expanded.income ? "▾" : "▸"} Incomings (before tax)</td>
                {CF_MONTHS.map((_, i) => <td key={i} style={cellStyle(i)} />)}
                <td style={annualCell()} />
              </tr>
              {expanded.income && Object.entries(d.income).map(([name, vals]) => {
                const ann = vals.reduce((s, v) => s + v, 0);
                if (ann === 0) return null;
                return <tr key={name} style={{ borderBottom: `1px solid ${COLORS.border}08` }}>
                  <td style={{ ...labelCell, paddingLeft: 32, fontSize: 12, color: COLORS.textDim }}>{name}</td>
                  {vals.map((v, i) => <td key={i} style={cellStyle(i)} onMouseEnter={() => setHCol(i)} onMouseLeave={() => setHCol(null)}>{v > 0 ? formatCF(v) : "–"}</td>)}
                  <td style={annualCell()}>{ann > 0 ? formatCF(ann) : "–"}</td>
                </tr>;
              })}
              <tr style={{ borderBottom: `2px solid ${COLORS.border}30`, background: COLORS.greenDim + "15" }}>
                <td style={{ ...totalLabel, background: COLORS.greenDim + "15" }}>Total Incomings</td>
                {d.totals.income.map((v, i) => <td key={i} style={{ ...totalStyle(i, COLORS.green), background: i === CF_CUR_MONTH ? COLORS.accent + "10" : COLORS.greenDim + "15" }} onMouseEnter={() => setHCol(i)} onMouseLeave={() => setHCol(null)}>{formatCF(v)}</td>)}
                <td style={{ ...annualCell(), color: COLORS.green, fontWeight: 700, fontSize: 13 }}>{formatCF(annualIncome)}</td>
              </tr>

              <tr><td colSpan={14} style={{ height: 8, background: COLORS.card }} /></tr>

              {/* EXPENSES */}
              <tr style={{ borderBottom: `1px solid ${COLORS.border}20` }} onClick={() => setExpanded(p => ({ ...p, expenses: !p.expenses }))}>
                <td style={sectionLabel}>{expanded.expenses ? "▾" : "▸"} Outgoings</td>
                {CF_MONTHS.map((_, i) => <td key={i} style={cellStyle(i)} />)}
                <td style={annualCell()} />
              </tr>
              {expanded.expenses && Object.entries(d.expenses).map(([name, vals]) => {
                const ann = vals.reduce((s, v) => s + v, 0);
                if (ann === 0) return null;
                return <tr key={name} style={{ borderBottom: `1px solid ${COLORS.border}08` }}>
                  <td style={{ ...labelCell, paddingLeft: 32, fontSize: 12, color: COLORS.textDim }}>{name}</td>
                  {vals.map((v, i) => <td key={i} style={cellStyle(i)} onMouseEnter={() => setHCol(i)} onMouseLeave={() => setHCol(null)}>{v > 0 ? formatCF(v) : "–"}</td>)}
                  <td style={annualCell()}>{ann > 0 ? formatCF(ann) : "–"}</td>
                </tr>;
              })}
              <tr style={{ borderBottom: `2px solid ${COLORS.border}30`, background: COLORS.redDim + "15" }}>
                <td style={{ ...totalLabel, background: COLORS.redDim + "15" }}>Total Outgoings</td>
                {d.totals.expenses.map((v, i) => <td key={i} style={{ ...totalStyle(i, COLORS.red), background: i === CF_CUR_MONTH ? COLORS.accent + "10" : COLORS.redDim + "15" }} onMouseEnter={() => setHCol(i)} onMouseLeave={() => setHCol(null)}>{formatCF(v)}</td>)}
                <td style={{ ...annualCell(), color: COLORS.red, fontWeight: 700, fontSize: 13 }}>{formatCF(annualExpenses)}</td>
              </tr>

              <tr><td colSpan={14} style={{ height: 8, background: COLORS.card }} /></tr>

              {/* NET */}
              <tr style={{ background: "#ffffff06", borderBottom: `1px solid ${COLORS.border}30` }}>
                <td style={{ ...totalLabel, background: "#ffffff06" }}>Net Income</td>
                {d.totals.net.map((v, i) => <td key={i} style={{ ...totalStyle(i, v >= 0 ? COLORS.green : COLORS.red), background: i === CF_CUR_MONTH ? COLORS.accent + "10" : "#ffffff06", fontSize: 13 }} onMouseEnter={() => setHCol(i)} onMouseLeave={() => setHCol(null)}>{v >= 0 ? "+" : ""}{formatCF(v)}</td>)}
                <td style={{ ...annualCell(), color: annualNet >= 0 ? COLORS.green : COLORS.red, fontWeight: 700, fontSize: 13 }}>{annualNet >= 0 ? "+" : ""}{formatCF(annualNet)}</td>
              </tr>

              {/* SAVINGS */}
              <tr style={{ background: COLORS.accentDim + "15" }}>
                <td style={{ ...totalLabel, background: COLORS.accentDim + "15", fontSize: 14 }}>Total Savings<div style={{ fontSize: 10, fontWeight: 400, color: COLORS.textDim, marginTop: 2 }}>Opening: ${d.openingSavings.toLocaleString()}</div></td>
                {d.totals.savings.map((v, i) => <td key={i} style={{ ...totalStyle(i, COLORS.accent), background: i === CF_CUR_MONTH ? COLORS.accent + "15" : COLORS.accentDim + "15", fontSize: 14 }} onMouseEnter={() => setHCol(i)} onMouseLeave={() => setHCol(null)}>{formatCF(v)}</td>)}
                <td style={{ ...annualCell(), color: COLORS.accent, fontWeight: 700, fontSize: 14 }}>{formatCF(d.totals.savings[11])}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Key Cash Flow Observations</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          {[
            { icon: "📈", text: "Wages jump from $2,773 to $5,773 in March — income nearly doubles from that point forward.", color: COLORS.green },
            { icon: "🏠", text: "Rent expense of $1,733/month begins in April — eating into the wage increase.", color: COLORS.amber },
            { icon: "⚡", text: "October had $43,000 in 'Other' non-taxable income and $39,289 in 'Other' expenses — likely a property settlement.", color: COLORS.textDim },
            { icon: "📉", text: "December was the worst month: -$2,935 net due to reduced wages ($1,920), car rego ($1,049), and high general spending ($2,176).", color: COLORS.red },
            { icon: "💰", text: `Savings grow from $2,850 to a projected $14,692 by June — a ${Math.round(((14692 - 2850) / 2850) * 100)}% increase over the year.`, color: COLORS.accent },
            { icon: "📊", text: "Eclipse Utilities alternate between $418-523 bi-monthly — budget shows gaps every other month.", color: COLORS.textDim },
          ].map((o, i) => <div key={i} style={{ display: "flex", gap: 12, padding: "10px 14px", background: COLORS.bg, borderRadius: 8, borderLeft: `3px solid ${o.color}` }}><span style={{ fontSize: 16 }}>{o.icon}</span><span style={{ color: COLORS.text, lineHeight: 1.6 }}>{o.text}</span></div>)}
        </div>
      </div>
    </div>
  );
}
