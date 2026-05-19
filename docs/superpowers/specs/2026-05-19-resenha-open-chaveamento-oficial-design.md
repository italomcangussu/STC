# Resenha Open Official Brackets Design

## Context

The active `Resenha Open 2026` championship already exists in the database and has registrations for `4ª Classe` and `5ª Classe`.

The official bracket source is the two provided published images. The saved bracket must be replaced with those exact matchups, not redrawn by the app.

All dates below refer to 2026.

## Goals

- Replace the already saved active Resenha Open bracket with the official bracket from the images.
- Preserve all existing registrations.
- Support Derlan being registered in both `4ª Classe` and `5ª Classe`.
- Keep final point generation valid only from Derlan's `5ª Classe` registration when a duplicate socio registration exists.
- Update app logic so future Resenha Open bracket generation matches this new model.

## Non-Goals

- Do not create a new championship.
- Do not delete registrations.
- Do not enforce match times as scheduling rules. Times are informational only.
- Do not redesign the public bracket UI beyond what is needed to display the new phases and match numbers correctly.

## Dates And Phases

### 5ª Classe

- `oitavas`: May 19, 2026 to May 22, 2026.
- `quartas`: May 22, 2026 to May 23, 2026.
- `semifinal`: May 23, 2026 to May 24, 2026.
- `final`: May 23, 2026 to May 24, 2026.

### 4ª Classe

- `preliminar`: May 19, 2026 to May 22, 2026.
- `oitavas`: May 22, 2026 to May 23, 2026.
- `quartas`: May 23, 2026 to May 24, 2026.
- `semifinal`: May 23, 2026 to May 24, 2026.
- `final`: May 23, 2026 to May 24, 2026.

## Official 5ª Classe Bracket

Format: 16-player single elimination, match numbers J1-J15.

First round:

- J1, 17:00: Davi Arcelino vs Williams Santos
- J2, 18:00: Lucas Rodrigues vs Macel Ponte
- J3, 19:00: Mailson Freitas vs Diego Parente
- J4, 20:00: Thiago Freitas vs Derlan
- J5, 21:00: Marcelino vs Victor Luceti
- J6, 22:00: Mardes Souza vs Vinicius Cangussú
- J7, 23:00: Ricardo Barroso vs Romário Soares
- J8, 00:00: Helder Filho vs Ítalo Cangussú

Quarterfinals:

- J9, 17:00: winner J1 vs winner J2
- J10, 18:00: winner J3 vs winner J4
- J11, 19:00: winner J5 vs winner J6
- J12, 20:00: winner J7 vs winner J8

Semifinals:

- J13, 17:00: winner J9 vs winner J10
- J14, 18:00: winner J11 vs winner J12

Final:

- J15, 20:00: winner J13 vs winner J14

## Official 4ª Classe Bracket

Format: 20-player mixed bracket, match numbers J1-J19.

Preliminary:

- J1, 17:00: Hernandes Soares vs Claudio Sergio
- J2, 18:00: Derlan vs Joaquim Brandrão
- J3, 19:00: Ismael Pedroza vs Frederico Santana
- J4, 20:00: Hermeson Veras vs Francielton Miranda

Round of 16:

- J5, 17:00: Thieslley Soares vs winner J1
- J6, 18:00: Miguel Júnior vs Henrique Coelho
- J7, 21:00: Bruno Farias vs Diego Memória
- J8, 19:00: Gustavo Morais vs winner J2
- J9, 20:00: Rafael Fernandes vs winner J3
- J10, 22:00: Ednaldo Soares vs Mario Rego
- J11, informational time not fixed: Tiago Gomes vs Marcelo Sampieri
- J12, 21:00: Josiel Simplício vs winner J4

Quarterfinals:

- J13, 17:00: winner J5 vs winner J6
- J14, 18:00: winner J7 vs winner J8
- J15, 19:00: winner J9 vs winner J10
- J16, 20:00: winner J11 vs winner J12

Semifinals:

- J17, 17:00: winner J13 vs winner J14
- J18, 18:00: winner J15 vs winner J16

Final:

- J19, 20:00: winner J17 vs winner J18

## Data Model

Use the existing tables:

- `championship_rounds` for phase date ranges.
- `matches` for match number, direct participants, source match dependencies, status, and optional informational schedule fields if present in the schema.
- `championship_registrations` as the only participant identity source.

Resolve every direct participant by `championship_registrations.id`, scoped by championship and class. Display-name matching is only a migration convenience and must tolerate the current database spellings:

- `Willams Santos` in the image maps to the existing `Williams Santos` registration.
- `Ismael Pedroza` in the image maps to the existing `ISAMAEL PEDROZA` registration.
- `Claudio Sergio` maps to `CLAUDIO SERGIO`.
- `Joaquim Brandrão` maps to `JOAQUIM BRANDRÃO`.
- `Rafael Fernandes` maps to `RAFAEL FRENANDES`.
- `Hernandes Soares` maps to `HERNADES SOARES`.
- `Ítalo Cangussu` maps to `Ítalo Cangussú`.
- `Vinícius Cangussu` maps to `Vinicius Cangussú`.
- `Derlan André` maps to the existing `Derlan` socio registration in the corresponding class.

The saved bracket replacement should be idempotent:

- Resolve the active `resenha-open` championship.
- Resolve registrations by class and display name.
- Delete current matches for the active championship.
- Replace Resenha Open-specific rounds with the new phase set.
- Insert all official matches with direct slots and source-match slots.
- Patch `player_a_source_match_id` and `player_b_source_match_id` after inserting matches.

If the schema has a usable time/date field on `matches`, write image times there as informational metadata. If not, keep phase date ranges in `championship_rounds` and preserve times in code/spec only.

## App Logic

Update pure bracket logic:

- `5ª Classe`: keep 16 athletes, but change quarterfinal dependencies to J1/J2, J3/J4, J5/J6, J7/J8.
- `4ª Classe`: expect 20 athletes, create J1-J4 preliminaries, J5-J12 oitavas, J13-J16 quartas, J17-J18 semifinals, and J19 final.
- Remove the old 4ª Classe concepts of three qualify matches, second phase, and three separate quarter seeds.

Update service phase mapping:

- Add `preliminar` and `oitavas` support for 4ª Classe.
- Remove `segunda_fase` from the active Resenha Open flow.
- Keep final-phase mapping so preliminary and round-of-16 losses map to canonical `round_of_16` or `participation` according to the existing ranking convention.

Update admin UI:

- 4ª Classe target count becomes 20.
- The old multi-step draw UI for 4ª Classe should be replaced or bypassed for the official bracket replacement flow.
- Existing public bracket display should order phases as: `preliminar`, `oitavas`, `quartas`, `semifinal`, `final`.

## Testing

Add or update tests for:

- 5ª Classe bracket dependencies:
  - J9 depends on J1 and J2.
  - J10 depends on J3 and J4.
  - J11 depends on J5 and J6.
  - J12 depends on J7 and J8.
- 4ª Classe bracket dependencies:
  - J5 slot B depends on J1.
  - J8 slot B depends on J2.
  - J9 slot B depends on J3.
  - J12 slot B depends on J4.
  - J13-J19 follow adjacent knockout progression.
- Advancement logic propagates winners into the correct dependent slots.
- Service phase map includes the new phase names.
- Database replacement migration is idempotent and refuses to proceed if required registrations are missing.

## Open Decisions

None. The user approved replacing the already saved bracket with the official image matchups and the date ranges listed above.
