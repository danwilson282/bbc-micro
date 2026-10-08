#!/usr/bin/env bash
# Downloads the CPU test suites into test-fixtures/ (gitignored).
#
#   scripts/fetch-test-fixtures.sh            the 151 documented opcodes
#   scripts/fetch-test-fixtures.sh a9 69      just these opcodes (plus Dormann)
#
# Stage 19: Tom Harte's SingleStepTests for the NMOS 6502, one JSON file per
# opcode, 10,000 cases each, captured from a model of the real chip
# (https://github.com/SingleStepTests/65x02). About 3-5 MB per file, roughly
# 600 MB for all 151. Files already present are skipped, so it's safe to re-run.
#
# Stage 20: Klaus Dormann's 6502 functional test, a 64 KB memory image
# (code at &0400, success trap at &3469) and its assembler listing, which
# names the check behind every trap address. About 0.8 MB, always fetched.
# (https://github.com/Klaus2m5/6502_65C02_functional_tests)
#
# Both are pinned to one commit, so everyone tests against the same data.

set -euo pipefail

SINGLESTEP_COMMIT="b7ed82824258d999aeb233324f6ea60c6cc4570a"
SINGLESTEP_URL="https://raw.githubusercontent.com/SingleStepTests/65x02/${SINGLESTEP_COMMIT}/6502/v1"
SINGLESTEP_DIR="test-fixtures/singlestep/6502"

DORMANN_COMMIT="7954e2dbb49c469ea286070bf46cdd71aeb29e4b"
DORMANN_URL="https://raw.githubusercontent.com/Klaus2m5/6502_65C02_functional_tests/${DORMANN_COMMIT}/bin_files"
DORMANN_DIR="test-fixtures/dormann"
DORMANN_FILES="6502_functional_test.bin 6502_functional_test.lst"

# The 151 documented opcodes. src/cpu/singlestep.test.ts checks this list
# against the CPU's opcode table, so the two can't drift apart.
DOCUMENTED_OPCODES="
00 01 05 06 08 09 0a 0d 0e 10 11 15 16 18 19 1d 1e 20 21 24 25 26 28 29 2a 2c 2d 2e
30 31 35 36 38 39 3d 3e 40 41 45 46 48 49 4a 4c 4d 4e 50 51 55 56 58 59 5d 5e 60 61
65 66 68 69 6a 6c 6d 6e 70 71 75 76 78 79 7d 7e 81 84 85 86 88 8a 8c 8d 8e 90 91 94
95 96 98 99 9a 9d a0 a1 a2 a4 a5 a6 a8 a9 aa ac ad ae b0 b1 b4 b5 b6 b8 b9 ba bc bd
be c0 c1 c4 c5 c6 c8 c9 ca cc cd ce d0 d1 d5 d6 d8 d9 dd de e0 e1 e4 e5 e6 e8 e9 ea
ec ed ee f0 f1 f5 f6 f8 f9 fd fe
"

cd "$(dirname "$0")/.."
mkdir -p "$SINGLESTEP_DIR" "$DORMANN_DIR"

# Downloads $2 to $1 unless it's already there. A temporary name first, so an
# interrupted download never leaves a half-written file that looks complete.
# Returns 1 for "already there". It's called as an if condition, where bash
# ignores set -e, so a failed download has to exit the script itself.
fetch() {
  if [ -s "$1" ]; then return 1; fi
  echo "fetching $(basename "$1")"
  curl --fail --silent --show-error --location -o "$1.part" "$2" || { echo "download failed: $2" >&2; exit 1; }
  mv "$1.part" "$1"
}

dormann_fetched=0
for name in $DORMANN_FILES; do
  if fetch "$DORMANN_DIR/$name" "$DORMANN_URL/$name"; then dormann_fetched=$((dormann_fetched + 1)); fi
done
echo "Dormann: $dormann_fetched fetched, in $DORMANN_DIR"

if [ "$#" -gt 0 ]; then opcodes="$*"; else opcodes="$DOCUMENTED_OPCODES"; fi

fetched=0
skipped=0
for op in $opcodes; do
  if fetch "$SINGLESTEP_DIR/$op.json" "$SINGLESTEP_URL/$op.json"; then
    fetched=$((fetched + 1))
  else
    skipped=$((skipped + 1))
  fi
done

echo "SingleStepTests: $fetched fetched, $skipped already present, in $SINGLESTEP_DIR"
