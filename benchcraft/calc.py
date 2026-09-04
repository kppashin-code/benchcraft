import math

UNITS = {
    "volume": {"L": 1.0, "mL": 1e-3, "uL": 1e-6, "nL": 1e-9},
    "mass": {"kg": 1e3, "g": 1.0, "mg": 1e-3, "ug": 1e-6, "ng": 1e-9},
    "molar": {"M": 1.0, "mM": 1e-3, "uM": 1e-6, "nM": 1e-9, "pM": 1e-12},
}


class CalcError(ValueError):
    pass


def _to_base(value: float, unit: str, kind: str) -> float:
    table = UNITS[kind]
    if unit not in table:
        raise CalcError(f"'{unit}' is not a {kind} unit. Use one of {', '.join(table)}.")
    return value * table[unit]


def _tidy(value: float, kind: str) -> tuple[float, str]:
    table = UNITS[kind]
    for unit, factor in sorted(table.items(), key=lambda kv: -kv[1]):
        if abs(value) >= factor:
            return round(value / factor, 4), unit
    unit = min(table, key=lambda u: table[u])
    return round(value / table[unit], 4), unit


def dilution(c1: float, c1_unit: str, c2: float, c2_unit: str,
             v2: float, v2_unit: str) -> dict:
    C1 = _to_base(c1, c1_unit, "molar")
    C2 = _to_base(c2, c2_unit, "molar")
    V2 = _to_base(v2, v2_unit, "volume")
    if C1 <= 0:
        raise CalcError("The stock concentration must be above zero.")
    if C2 > C1:
        raise CalcError(
            "The target is more concentrated than the stock. You cannot dilute up to it."
        )
    V1 = C1 and (C2 * V2) / C1
    stock, su = _tidy(V1, "volume")
    diluent, du = _tidy(V2 - V1, "volume")
    return {
        "formula": "C1 V1 = C2 V2",
        "answer": f"{stock} {su} of stock, made up to {v2} {v2_unit}",
        "steps": [
            f"V1 = C2 V2 / C1 = ({c2} {c2_unit} x {v2} {v2_unit}) / {c1} {c1_unit}",
            f"take {stock} {su} of stock",
            f"add {diluent} {du} of diluent to reach {v2} {v2_unit}",
        ],
        "fold": round(C1 / C2, 2) if C2 else None,
    }


def mass_for_molarity(mw: float, molarity: float, m_unit: str,
                      volume: float, v_unit: str) -> dict:
    if mw <= 0:
        raise CalcError("Molecular weight must be above zero.")
    M = _to_base(molarity, m_unit, "molar")
    V = _to_base(volume, v_unit, "volume")
    grams = mw * M * V
    amount, unit = _tidy(grams, "mass")
    return {
        "formula": "mass = MW x M x V",
        "answer": f"{amount} {unit}",
        "steps": [
            f"mass = {mw} g/mol x {molarity} {m_unit} x {volume} {v_unit}",
            f"= {grams:.6g} g",
            f"= {amount} {unit}",
        ],
    }


def percent_solution(percent: float, volume: float, v_unit: str, basis: str = "w/v") -> dict:
    V = _to_base(volume, v_unit, "volume")
    grams = (percent / 100.0) * V * 1000.0
    amount, unit = _tidy(grams, "mass")
    return {
        "formula": f"{basis}: {percent}% means {percent} g per 100 mL",
        "answer": f"{amount} {unit} in {volume} {v_unit}",
        "steps": [
            f"{percent} g per 100 mL x {V * 1000:.6g} mL / 100 = {grams:.6g} g",
            f"= {amount} {unit}",
        ],
    }


def serial_dilution(start: float, unit: str, fold: float, steps: int) -> dict:
    if fold <= 1:
        raise CalcError("The fold must be greater than 1.")
    if steps < 1 or steps > 24:
        raise CalcError("Use between 1 and 24 steps.")
    out, conc = [], _to_base(start, unit, "molar")
    for i in range(steps + 1):
        v, u = _tidy(conc, "molar")
        out.append(f"step {i}: {v} {u}")
        conc /= fold
    return {
        "formula": f"1 in {fold} each step",
        "answer": out[-1].split(": ")[1] + " at the last step",
        "steps": out,
    }


def cell_seeding(density: float, area_or_volume: float, unit: str) -> dict:
    total = density * area_or_volume
    return {
        "formula": "cells = density x amount",
        "answer": f"{total:,.0f} cells",
        "steps": [
            f"{density:,.0f} per {unit} x {area_or_volume:g} {unit}",
            f"= {total:,.0f} cells",
        ],
    }


def g_to_rcf(rpm: float, radius_mm: float) -> dict:
    rcf = 1.118e-5 * radius_mm / 10.0 * rpm ** 2
    return {
        "formula": "RCF = 1.118e-5 x r(cm) x rpm^2",
        "answer": f"{rcf:,.0f} x g",
        "steps": [
            f"r = {radius_mm} mm = {radius_mm / 10:g} cm",
            f"RCF = 1.118e-5 x {radius_mm / 10:g} x {rpm:g}^2 = {rcf:,.0f} x g",
        ],
    }


def rcf_to_rpm(rcf: float, radius_mm: float) -> dict:
    if radius_mm <= 0:
        raise CalcError("Rotor radius must be above zero.")
    rpm = math.sqrt(rcf / (1.118e-5 * radius_mm / 10.0))
    return {
        "formula": "rpm = sqrt(RCF / (1.118e-5 x r(cm)))",
        "answer": f"{rpm:,.0f} rpm",
        "steps": [
            f"r = {radius_mm} mm = {radius_mm / 10:g} cm",
            f"rpm = sqrt({rcf:g} / (1.118e-5 x {radius_mm / 10:g})) = {rpm:,.0f} rpm",
        ],
    }


KINDS = {
    "dilution": dilution,
    "molarity": mass_for_molarity,
    "percent": percent_solution,
    "serial": serial_dilution,
    "seeding": cell_seeding,
    "rcf": g_to_rcf,
    "rpm": rcf_to_rpm,
}


def run(kind: str, args: dict) -> dict:
    fn = KINDS.get(kind)
    if not fn:
        raise CalcError(f"No calculation called '{kind}'.")
    try:
        out = fn(**args)
    except CalcError:
        raise
    except TypeError as e:
        raise CalcError(f"Wrong inputs for {kind}: {e}")
    except (ValueError, ZeroDivisionError, OverflowError) as e:
        raise CalcError(str(e))
    out["kind"] = kind
    return out
