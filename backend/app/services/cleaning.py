"""pandas port of src/lib/dataCleaning.ts: same steps, same order, same report wording."""
import datetime
import io
import json
import math
import re
import warnings as _warnings

import numpy as np
import pandas as pd

MISSING_SPARSE_THRESHOLD = 0.5   # same value as the TypeScript constant
NULL_TOKENS = {"", "n/a", "na", "null", "none", "nan", "-", "--", "?", "undefined", "#n/a"}
TRUE_TOKENS = {"true", "yes", "y", "1"}
FALSE_TOKENS = {"false", "no", "n", "0"}
BOOL_TOKENS = {"true", "false", "yes", "no", "y", "n"}
SQL_TYPE = {"numeric": "NUMBER", "datetime": "DATE", "boolean": "BOOLEAN",
            "categorical": "CATEGORICAL", "text": "TEXT"}
SQL_RESERVED = {  # only words that would break an unquoted SQL query
    "select", "from", "where", "group", "order", "by", "table", "limit", "join", "insert",
    "update", "delete", "values", "column", "default", "primary", "check", "case", "when",
    "then", "end", "and", "or", "not", "null", "like", "in", "as", "on", "having", "union",
    "all", "distinct", "create", "drop", "alter",
}
MONTH_RE = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b", re.I)


# ---------- helpers ----------
def _js_round2(x: float) -> float:
    return math.floor(x * 100 + 0.5) / 100


def _js_str(v) -> str:
    if isinstance(v, (bool, np.bool_)):
        return "true" if v else "false"
    if isinstance(v, (float, np.floating)) and float(v).is_integer():
        return str(int(v))
    return str(v)


def _py(v):
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return float(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def _records(df: pd.DataFrame) -> list:
    return json.loads(df.to_json(orient="records"))


def _to_object(s: pd.Series) -> pd.Series:
    """Plain object column with None for missing (JSON friendly)."""
    return s.astype(object).where(s.notna(), None)


def load_csv(content: bytes) -> pd.DataFrame:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    df = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
    if df.shape[1] == 1:
        first = text.splitlines()[0]
        for sep in (";", "\t", "|"):
            if sep in first:
                df = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False, sep=sep)
                break
    if df.empty:
        raise ValueError("This CSV has no rows.")
    return df


def to_snake_case(name: str) -> str:
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(name).strip())
    name = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return name or "column"


def parse_number(value):
    """"Rs 1,500" / "$2,000.50" / "(300)" / "45%" -> float, or None."""
    text = str(value).strip()
    if not text:
        return None
    negative = False
    if re.fullmatch(r"\(.*\)", text):
        negative, text = True, text[1:-1]
    text = re.sub(r"^(rs\.?|inr|usd|eur|gbp)\s*", "", text, flags=re.I)
    text = re.sub(r"\s*(rs\.?|inr|usd|eur|gbp)$", "", text, flags=re.I)
    text = re.sub(r"[₹$€£¥]", "", text)
    text = re.sub(r"%$", "", text)
    text = re.sub(r"\s+", "", text.replace(",", ""))
    if not re.fullmatch(r"[-+]?\d*\.?\d+(e[-+]?\d+)?", text, flags=re.I):
        return None
    n = float(text)
    if not math.isfinite(n):
        return None
    return -n if negative else n


def _valid_date(y: int, m: int, d: int):
    if m < 1 or m > 12 or d < 1 or d > 31:
        return None
    try:
        return datetime.date(y, m, d).isoformat()
    except ValueError:
        return None


def parse_date(value):
    """YYYY-MM-DD, DD/MM/YYYY, MM-DD-YYYY ... Slash = day first, dash = month first,
    unless the numbers allow only one reading."""
    text = str(value).strip()
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$", text)
    if m:
        return _valid_date(*map(int, m.groups()))
    m = re.match(r"^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$", text)
    if m:
        a, sep, b, y = int(m.group(1)), m.group(2), int(m.group(3)), int(m.group(4))
        if a > 12:
            return _valid_date(y, b, a)
        if b > 12:
            return _valid_date(y, a, b)
        return _valid_date(y, a, b) if sep == "-" else _valid_date(y, b, a)
    if MONTH_RE.search(text) and re.search(r"\d{4}", text):
        with _warnings.catch_warnings():
            _warnings.simplefilter("ignore")
            ts = pd.to_datetime(text, errors="coerce")
        if pd.notna(ts):
            return _valid_date(ts.year, ts.month, ts.day)
    return None


def title_case(text: str) -> str:
    return re.sub(r"(^|[\s\-/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), text.lower())


def detect_type(values: list) -> str:
    if not values:
        return "text"
    n = len(values)
    low = [v.lower() for v in values]
    if all(v in BOOL_TOKENS for v in low):
        return "boolean"
    if sum(parse_number(v) is not None for v in values) / n >= 0.9:
        return "numeric"
    if sum(parse_date(v) is not None for v in values) / n >= 0.9:
        return "datetime"
    if len(set(low)) <= max(12, n * 0.5) and all(len(v) <= 40 for v in values):
        return "categorical"
    return "text"


# ---------- pipeline steps ----------
def clean_column_names(columns):
    out, seen, mapping = [], set(), {}
    for orig in columns:
        base = to_snake_case(orig)
        if base[0].isdigit():
            base = "col_" + base
        if base in SQL_RESERVED:
            base += "_col"
        name, i = base, 2
        while name in seen:
            name = f"{base}_{i}"
            i += 1
        seen.add(name)
        out.append(name)
        mapping[str(orig)] = name
    return out, mapping


def handle_missing_values(df: pd.DataFrame, types: dict):
    filled, sparse, warns = {}, [], []
    n = len(df)
    for c, t in types.items():
        miss = df[c].isna()
        count = int(miss.sum())
        if count == 0:
            continue
        ratio = count / n if n else 0
        if ratio > MISSING_SPARSE_THRESHOLD:
            pct = math.floor(ratio * 100 + 0.5)
            sparse.append({"name": c, "missingPercent": pct})
            warns.append(f"Sparse column {c}: {pct}% missing, kept as is (nulls not filled).")
            continue
        if t == "numeric":
            nums = df[c].dropna().astype(float)
            if nums.empty:
                continue
            value = _js_round2(float(np.median(nums)))
            df[c] = df[c].where(~miss, value)
            filled[c] = {"count": count, "method": "median", "value": value}
        elif t in ("categorical", "text", "boolean"):
            present = [_js_str(v) for v in df[c].dropna()]
            has_mode = len(present) > 0
            if has_mode:
                counts: dict = {}
                for v in present:
                    counts[v] = counts.get(v, 0) + 1
                common = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
            else:
                common = "Unknown"
            value = (common == "true") if (t == "boolean" and has_mode) else common
            df[c] = df[c].where(~miss, value)
            filled[c] = {"count": count, "method": "most common" if has_mode else "placeholder",
                         "value": value}
        # datetime: left empty on purpose
    return filled, sparse, warns


def build_schema(df: pd.DataFrame, types: dict) -> list:
    schema = []
    for c in df.columns:
        col = df[c]
        present = [v for v in col if pd.notna(v) and v != ""]
        t = types[c]
        mn = mx = None
        if t == "numeric" and present:
            mn, mx = _py(min(present)), _py(max(present))
        elif t == "datetime" and present:
            s = sorted(str(v) for v in present)
            mn, mx = s[0], s[-1]
        uniq = list(dict.fromkeys(_js_str(v) for v in present))
        schema.append({
            "name": c, "sqlType": SQL_TYPE[t], "nullCount": len(col) - len(present),
            "uniqueCount": len(uniq), "min": mn, "max": mx, "samples": uniq[:3],
        })
    return schema


def format_schema(schema: list, row_count: int) -> str:
    lines = [f"Cleaned data schema ({row_count} rows)"]
    for c in schema:
        rng = f"; range {_js_str(c['min'])} to {_js_str(c['max'])}" if c["min"] is not None else ""
        smp = f"; samples: {', '.join(c['samples'])}" if c["samples"] else ""
        lines.append(f"- {c['name']} ({c['sqlType']}); {c['nullCount']} nulls; {c['uniqueCount']} unique{rng}{smp}")
    return "\n".join(lines)


def run_pipeline(content: bytes) -> dict:
    raw = load_csv(content)
    warns: list = []
    original_columns = [str(c) for c in raw.columns]

    # 1. rename columns
    new_names, mapping = clean_column_names(original_columns)
    renamed = {o: n for o, n in mapping.items() if o != n}
    column_source = {n: o for o, n in mapping.items()}

    # 2. trim text + normalise null tokens
    df = pd.DataFrame(index=raw.index)
    for orig, name in zip(original_columns, new_names):
        s = raw[orig].astype("string").str.strip().str.replace(r"\s+", " ", regex=True)
        s = s.mask(s.str.lower().isin(NULL_TOKENS))
        df[name] = _to_object(s)

    # 3. remove empty rows, 4. drop fully empty columns
    before = len(df)
    df = df.dropna(how="all")
    empty_rows = before - len(df)
    dropped = [c for c in df.columns if df[c].isna().all()]
    df = df.drop(columns=dropped)
    if dropped:
        warns.append(f"Dropped fully empty column(s): {', '.join(dropped)}.")

    # 5. detect types and convert values
    types, conversions = {}, {}
    for c in df.columns:
        present = [str(v) for v in df[c] if pd.notna(v)]
        t = detect_type(present)
        types[c] = t
        failed = 0
        if t == "numeric":
            vals = [parse_number(v) if pd.notna(v) else None for v in df[c]]
            failed = sum(1 for o, v in zip(df[c], vals) if pd.notna(o) and v is None)
            df[c] = pd.Series(vals, index=df.index, dtype="float64")
            conversions[c] = "numeric (removed currency symbols, commas)"
        elif t == "datetime":
            vals = [parse_date(v) if pd.notna(v) else None for v in df[c]]
            failed = sum(1 for o, v in zip(df[c], vals) if pd.notna(o) and v is None)
            df[c] = pd.Series(vals, index=df.index, dtype=object)
            conversions[c] = "date (standardised to YYYY-MM-DD)"
        elif t == "boolean":
            def to_bool(v):
                if pd.isna(v):
                    return None
                low = str(v).lower()
                return True if low in TRUE_TOKENS else False if low in FALSE_TOKENS else None
            df[c] = pd.Series([to_bool(v) for v in df[c]], index=df.index, dtype=object)
            conversions[c] = "boolean (true/false)"
        elif t == "categorical":
            df[c] = pd.Series([title_case(str(v)) if pd.notna(v) else None for v in df[c]],
                              index=df.index, dtype=object)
            conversions[c] = "category (consistent capitalisation)"
        else:
            conversions[c] = "text (trimmed)"
        if failed:
            warns.append(f'{failed} value(s) in "{c}" could not be read as {t} and were left empty.')

    # 6. remove duplicates (after normalisation, so "Delhi " == "delhi")
    before = len(df)
    df = df.drop_duplicates()
    duplicates = before - len(df)

    # 7. missing values (sparse columns are kept untouched)
    filled, sparse, miss_warns = handle_missing_values(df, types)
    warns += miss_warns

    # 8. outliers: flag only (IQR rule)
    outliers = {}
    for c, t in types.items():
        if t != "numeric":
            continue
        nums = df[c].dropna().astype(float).sort_values().to_numpy()
        if len(nums) < 8:
            continue
        q1, q3 = np.quantile(nums, [0.25, 0.75])
        iqr = q3 - q1
        lo, hi = _js_round2(float(q1 - 1.5 * iqr)), _js_round2(float(q3 + 1.5 * iqr))
        cnt = int(((nums < lo) | (nums > hi)).sum())
        if cnt:
            outliers[c] = {"count": cnt, "lowerBound": lo, "upperBound": hi}

    schema = build_schema(df, types)
    report = {
        "rowsBefore": len(raw), "rowsAfter": len(df),
        "columnsBefore": len(original_columns), "columnsAfter": df.shape[1],
        "renamedColumns": renamed, "duplicatesRemoved": duplicates, "emptyRowsRemoved": empty_rows,
        "columnsDropped": dropped, "missingFilled": filled, "sparseColumns": sparse,
        "typeConversions": conversions, "outliersFlagged": outliers, "warnings": warns,
    }
    return {
        "rawRows": _records(raw),
        "cleanedRows": _records(df),
        "sourceRows": [int(i) for i in df.index],   # original row number of each cleaned row
        "columnSource": column_source,
        "schema": schema,
        "schemaText": format_schema(schema, len(df)),
        "report": report,
    }