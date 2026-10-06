// Ported from benchcraft/calc.py.
const UNITS = {
  volume: { L: 1.0, mL: 1e-3, uL: 1e-6, nL: 1e-9 },
  mass: { kg: 1e3, g: 1.0, mg: 1e-3, ug: 1e-6, ng: 1e-9 },
  molar: { M: 1.0, mM: 1e-3, uM: 1e-6, nM: 1e-9, pM: 1e-12 },
};

export class CalcError extends Error {}

const g = (x) => String(Number(Number(x).toPrecision(6)));
const comma0 = (x) => Math.round(x).toLocaleString("en-US");
const r4 = (x) => Math.round(x * 1e4) / 1e4;

function toBase(value, unit, kind) {
  const table = UNITS[kind];
  if (!(unit in table)) throw new CalcError(`'${unit}' is not a ${kind} unit. Use one of ${Object.keys(table).join(", ")}.`);
  return value * table[unit];
}

function tidy(value, kind) {
  const entries = Object.entries(UNITS[kind]).sort((a, b) => b[1] - a[1]);
  for (const [unit, factor] of entries) if (Math.abs(value) >= factor) return [r4(value / factor), unit];
  const [unit, factor] = entries[entries.length - 1];
  return [r4(value / factor), unit];
}

function dilution({ c1, c1_unit, c2, c2_unit, v2, v2_unit }) {
  const C1 = toBase(c1, c1_unit, "molar"), C2 = toBase(c2, c2_unit, "molar"), V2 = toBase(v2, v2_unit, "volume");
  if (C1 <= 0) throw new CalcError("The stock concentration must be above zero.");
  if (C2 > C1) throw new CalcError("The target is more concentrated than the stock. You cannot dilute up to it.");
  const V1 = (C2 * V2) / C1;
  const [stock, su] = tidy(V1, "volume");
  const [diluent, du] = tidy(V2 - V1, "volume");
  return {
    formula: "C1 V1 = C2 V2",
    answer: `${stock} ${su} of stock, made up to ${v2} ${v2_unit}`,
    steps: [
      `V1 = C2 V2 / C1 = (${c2} ${c2_unit} x ${v2} ${v2_unit}) / ${c1} ${c1_unit}`,
      `take ${stock} ${su} of stock`,
      `add ${diluent} ${du} of diluent to reach ${v2} ${v2_unit}`,
    ],
    fold: C2 ? Math.round((C1 / C2) * 100) / 100 : null,
  };
}

function molarity({ mw, molarity, m_unit, volume, v_unit }) {
  if (mw <= 0) throw new CalcError("Molecular weight must be above zero.");
  const grams = mw * toBase(molarity, m_unit, "molar") * toBase(volume, v_unit, "volume");
  const [amount, unit] = tidy(grams, "mass");
  return {
    formula: "mass = MW x M x V",
    answer: `${amount} ${unit}`,
    steps: [`mass = ${mw} g/mol x ${molarity} ${m_unit} x ${volume} ${v_unit}`, `= ${g(grams)} g`, `= ${amount} ${unit}`],
  };
}

function percent({ percent, volume, v_unit, basis = "w/v" }) {
  const V = toBase(volume, v_unit, "volume");
  const grams = (percent / 100) * V * 1000;
  const [amount, unit] = tidy(grams, "mass");
  return {
    formula: `${basis}: ${percent}% means ${percent} g per 100 mL`,
    answer: `${amount} ${unit} in ${volume} ${v_unit}`,
    steps: [`${percent} g per 100 mL x ${g(V * 1000)} mL / 100 = ${g(grams)} g`, `= ${amount} ${unit}`],
  };
}

function serial({ start, unit, fold, steps }) {
  if (fold <= 1) throw new CalcError("The fold must be greater than 1.");
  if (steps < 1 || steps > 24) throw new CalcError("Use between 1 and 24 steps.");
  const out = [];
  let conc = toBase(start, unit, "molar");
  for (let i = 0; i <= steps; i++) {
    const [v, u] = tidy(conc, "molar");
    out.push(`step ${i}: ${v} ${u}`);
    conc /= fold;
  }
  return { formula: `1 in ${fold} each step`, answer: out[out.length - 1].split(": ")[1] + " at the last step", steps: out };
}

function seeding({ density, area_or_volume, unit }) {
  const total = density * area_or_volume;
  return {
    formula: "cells = density x amount",
    answer: `${comma0(total)} cells`,
    steps: [`${comma0(density)} per ${unit} x ${g(area_or_volume)} ${unit}`, `= ${comma0(total)} cells`],
  };
}

function rcf({ rpm, radius_mm }) {
  const v = (1.118e-5 * radius_mm) / 10 * rpm ** 2;
  return {
    formula: "RCF = 1.118e-5 x r(cm) x rpm^2",
    answer: `${comma0(v)} x g`,
    steps: [`r = ${radius_mm} mm = ${g(radius_mm / 10)} cm`, `RCF = 1.118e-5 x ${g(radius_mm / 10)} x ${g(rpm)}^2 = ${comma0(v)} x g`],
  };
}

function rpm({ rcf: force, radius_mm }) {
  if (radius_mm <= 0) throw new CalcError("Rotor radius must be above zero.");
  const v = Math.sqrt(force / ((1.118e-5 * radius_mm) / 10));
  return {
    formula: "rpm = sqrt(RCF / (1.118e-5 x r(cm)))",
    answer: `${comma0(v)} rpm`,
    steps: [`r = ${radius_mm} mm = ${g(radius_mm / 10)} cm`, `rpm = sqrt(${g(force)} / (1.118e-5 x ${g(radius_mm / 10)})) = ${comma0(v)} rpm`],
  };
}

const KINDS = { dilution, molarity, percent, serial, seeding, rcf, rpm };

export function run(kind, args) {
  const fn = KINDS[kind];
  if (!fn) throw new CalcError(`No calculation called '${kind}'.`);
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "number" && !Number.isFinite(v)) throw new CalcError(`Wrong inputs for ${kind}: ${k} is not a number.`);
  }
  const out = fn(args);
  for (const s of [out.answer, ...out.steps]) if (/NaN|Infinity/.test(s)) throw new CalcError("Those inputs do not give a finite answer.");
  return { ...out, kind };
}
