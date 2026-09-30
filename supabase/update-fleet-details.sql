-- ==========================================================================
-- Fleet Info: Add columns and populate vehicle details
-- Source: "Astrea Plant and Fleet Register.xlsx" → "Fleet Info" sheet
-- Run this in the Supabase SQL Editor
-- ==========================================================================

BEGIN;

-- 1. Add new columns to the vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "vin" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "variant" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "linktTag" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "wrdtPlantNo" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "evieFob" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "evieCard" text;

-- 2. Populate data — light vehicles (ALV01–ALV47)

UPDATE vehicles SET "variant"='NLR45-150 AMT', "vin"='MNAUMFF50MW131219', odometer=28000, "nextServiceKm"=40000, "linktTag"='202509187227' WHERE id='ALV01';
UPDATE vehicles SET "variant"='PXIII 3.2L DIE 6SPA XLS CRWCAB', "vin"='MPBUMFF50MX327504', odometer=138000, "nextServiceKm"=153000, "linktTag"='194400847126', "wrdtPlantNo"='19/1/2026 service' WHERE id='ALV02';
UPDATE vehicles SET "variant"='PXIII 3.2L DIE 6SPA XLS CRWCAB', "vin"='MPBUMFF50MX339576', odometer=178100, "nextServiceKm"=180000, "linktTag"='211005915825' WHERE id='ALV03';
UPDATE vehicles SET "variant"='PXIII 3.2L DIE 6SPA XL CREWCAB', "vin"='MNAUMFF50MW159694', odometer=176000, "nextServiceKm"=190000, "linktTag"='211105344926' WHERE id='ALV04';
UPDATE vehicles SET "variant"='PXIII 3.2L DIE 6SPA XLS CRWCAB', "vin"='MPBUMEF80MX334473', odometer=104991, "nextServiceKm"=116000, "linktTag"='202509187227' WHERE id='ALV05';
UPDATE vehicles SET "variant"='PXIII 3.2L DIE 6SPA XLS CRWCAB', "vin"='MMAJLKL10NH024210', odometer=127557, "nextServiceKm"=140000, "linktTag"='192306351227' WHERE id='ALV06';
UPDATE vehicles SET "variant"='PXIII 3.2L DIE 6SPA XLS CRWCAB', "vin"='MMAJLKL10NH024229', odometer=57000, "nextServiceKm"=61000, "linktTag"='220522514029' WHERE id='ALV07';
UPDATE vehicles SET "variant"='PXIII 3.2L DIE 6SPA XLS CRWCAB', "vin"='MNACMFE60NW230507', odometer=150000, "nextServiceKm"=165000, "linktTag"='221102799923' WHERE id='ALV08';
UPDATE vehicles SET "variant"='PXIII 3.2L DIE 6SPA XLS CRWCAB', "vin"='MNACMFF60NW230412', odometer=95550, "nextServiceKm"=107000, "linktTag"='000 5640759' WHERE id='ALV09';
UPDATE vehicles SET "variant"='PXIII 2.2L DIE 6SPA XL CREWCC', "vin"='MMAJLKL10NH035734', odometer=90000, "nextServiceKm"=105000, "linktTag"='000 5594174' WHERE id='ALV10';
UPDATE vehicles SET "variant"='MR22 2.4D 6A GLX-R B04 CREWCAB', "vin"='MNACMFF60PW284415', odometer=105677, "nextServiceKm"=112000, "linktTag"='000 5896852' WHERE id='ALV11';
UPDATE vehicles SET "variant"='MR22 2.4D 6A GLX-R B04 CREWCAB', "vin"='MNACMFE60NW266714', odometer=91000, "nextServiceKm"=104000, "linktTag"='000 5896851' WHERE id='ALV12';
UPDATE vehicles SET "variant"='22 2.0L DIE 10SPA XLS CREWCAB', "vin"='MMAJLKK10PH009112', odometer=56480, "nextServiceKm"=65000, "linktTag"='221102799923' WHERE id='ALV13';
UPDATE vehicles SET "variant"='22 2.0L DIE 10SPA XL CREWCAB', "vin"='MNACMFF60PW272585', odometer=120119, "nextServiceKm"=133000, "linktTag"='000 5896850' WHERE id='ALV14';
UPDATE vehicles SET "variant"='MR22.5 2.4L D 6SPA GLX+ CRWCAB', "vin"='MMAJLKL10PH010216', odometer=63338, "nextServiceKm"=76000, "linktTag"='000 5896849' WHERE id='ALV15';
UPDATE vehicles SET "variant"='23.5 2.0L D 10SPA SPORT CRWCAB', "vin"='MNACMFF60PW303913', odometer=65000, "nextServiceKm"=70000, "linktTag"='232421652222' WHERE id='ALV16';
UPDATE vehicles SET "variant"='22 2.0L DIE 10SPA XL CABCHAS', "vin"='MNACMFF60RW319023', odometer=25000, "nextServiceKm"=31000, "linktTag"='232421937524' WHERE id='ALV17';
UPDATE vehicles SET "variant"='MR23 2.4L D 6SPA GLX-R CREWCAB', "vin"='MNACMFF60RW324709', odometer=19000, "nextServiceKm"=30000, "linktTag"='233307578929' WHERE id='ALV18';
UPDATE vehicles SET "variant"='22 2.0L DIE 10SPA XLS CREWCAB', "vin"='MNACMFF60RW324703', odometer=85000, "nextServiceKm"=100000, "linktTag"='233208682226' WHERE id='ALV19';
UPDATE vehicles SET "variant"='MR23 2.4L D 6SPA GLX-R CREWCAB', "vin"='MNACMFF60PW313732', odometer=43700, "nextServiceKm"=51000, "linktTag"='185007509424' WHERE id='ALV20';
UPDATE vehicles SET "variant"='2024 2.0L D 10SPA XLT CREWCAB', "vin"='MPBCM1F90PX544484', odometer=65430, "nextServiceKm"=80000, "linktTag"='000 5952958' WHERE id='ALV21';
UPDATE vehicles SET "variant"='2024 2.0L D 10SPA XLS CREWCAB', "vin"='MNACMFF60RW324709', odometer=52540, "nextServiceKm"=66259, "linktTag"='232421937524' WHERE id='ALV22';
UPDATE vehicles SET "variant"='2024.50 2L D 10SPA XLS CREWCAB', "vin"='MNACMFF60RW324703', odometer=64000, "nextServiceKm"=79000, "linktTag"='232421304824' WHERE id='ALV23';
UPDATE vehicles SET "variant"='2024.50 2L D 10SPA XLS CREWCAB', "vin"='WF0RXXTA4RRB16164', odometer=35000, "nextServiceKm"=45000, "linktTag"='000 5795250' WHERE id='ALV24';
UPDATE vehicles SET "variant"='2024 2.0L D 10SPA SPORT CRWCAB', "vin"='MNACMFF60RW333639', odometer=45000, "nextServiceKm"=60000, "linktTag"='241223310723' WHERE id='ALV25';
UPDATE vehicles SET "variant"='190TDI PREMIUM', "vin"='MPBCMFF60RX620352', odometer=130666, "nextServiceKm"=145666, "linktTag"='232421304824' WHERE id='ALV26';
UPDATE vehicles SET "variant"='2024 2.0L D 6SPA XL ONHLF CBCH', "vin"='MPBCM1F90PX544484', odometer=29500, "nextServiceKm"=44500, "linktTag"='5952958' WHERE id='ALV27';
UPDATE vehicles SET "variant"='22 3.0L 8SPA RDHSE 294 WAGON', "vin"='SALYA2AU9NA344417', "linktTag"='252103098726' WHERE id='ALV28';
UPDATE vehicles SET "variant"='AV 2.0L DIE 8SPA TREND LWB VAN', "vin"='JAANLR85EM7106854', odometer=5500, "nextServiceKm"=15000, "linktTag"='232522025542' WHERE id='ALV29';
UPDATE vehicles SET "variant"='2024.50 2L D 10SP XLT ONHLF PU', "vin"='JALFSR34MN7000603', odometer=31000, "nextServiceKm"=45000, "linktTag"='232522102648' WHERE id='ALV30';
UPDATE vehicles SET "variant"='24.5 2.0L D 10SPA BLK ED CRCAB', "vin"='JHDFE2AJ1XXX10597', odometer=27000, "nextServiceKm"=36000, "linktTag"='241322151820' WHERE id='ALV31';
UPDATE vehicles SET "variant"='X5 XDRI 12EVA WAGON', "vin"='6NMPLNTRLW000594', "linktTag"='241223310327' WHERE id='ALV32';
UPDATE vehicles SET "variant"='24.5 2.0L D 10SPA BLK ED CRCAB', "vin"='MPBCMFF60RX618767', odometer=19600, "nextServiceKm"=30000, "linktTag"='241321435620' WHERE id='ALV33';
UPDATE vehicles SET "variant"='B2DIC-2', "vin"='LPE19W2A0SF041808', "linktTag"='242121471724', "evieFob"='D4BBE341', "evieCard"='2506B7AD' WHERE id='ALV34';
UPDATE vehicles SET "variant"='57370B', "vin"='MPBCMFF60SX678314', odometer=3700, "nextServiceKm"=3000, "linktTag"='233201037428' WHERE id='ALV35';
UPDATE vehicles SET "variant"='2NYE5C002NR1 (E-AWD-M)', "vin"='LGXCF4CD7S2169279', "linktTag"='5989526', "evieFob"='E49DE541', "evieCard"='B51104AE' WHERE id='ALV36';
UPDATE vehicles SET "variant"='57350B', "vin"='MPBCMFF60SX714198', "nextServiceKm"=3000, "linktTag"='3028312424' WHERE id='ALV37';
UPDATE vehicles SET "variant"='57350B', "vin"='MPBCMFF60SX714226', odometer=1700, "nextServiceKm"=3000, "linktTag"='3028312425' WHERE id='ALV38';
UPDATE vehicles SET "variant"='3 3.0L 8SPA SLINE WAGON', "vin"='WAUZZZ4M8RD016433', odometer=46800, "nextServiceKm"=62000, "linktTag"='232206688045' WHERE id='ALV39';
UPDATE vehicles SET "variant"='26 2.0L D 10SP DCAB', "vin"='WV4ZZZT12SS020594', "nextServiceKm"=3000, "linktTag"='250920088326' WHERE id='ALV40';
UPDATE vehicles SET "variant"='26 V6 10SP DCAB', "vin"='MPBCMFF70TX745846', "nextServiceKm"=3000, "linktTag"='252103098726' WHERE id='ALV41';
UPDATE vehicles SET "variant"='25 59003E 2261.0 DCAB', "vin"='AFACMFF20SJ139732', odometer=1500, "nextServiceKm"=3000, "linktTag"='254501369626' WHERE id='ALV42';
UPDATE vehicles SET "variant"='26 57662C 2993.0 DCAB', "vin"='MNACMFF70TW377432', odometer=200, "nextServiceKm"=3000 WHERE id='ALV43';
UPDATE vehicles SET "variant"='26.5 3.0L D 10SPA BLK ED CRCAB', odometer=200, "nextServiceKm"=3000 WHERE id='ALV44';
UPDATE vehicles SET "variant"='SR25 SKHCX WAGON', "vin"='LGXCD4C47T0234148', "linktTag"='260317169928' WHERE id='ALV45';
UPDATE vehicles SET "variant"='26 57662C 2993.0 DCAB', "vin"='MNACMFF70TW380443' WHERE id='ALV46';
UPDATE vehicles SET "variant"='26 57662C 2993.0 DCAB', "vin"='MNACMFF70TW380331', "linktTag"='255116640921' WHERE id='ALV47';

-- Vac trucks (AVT01–AVT08)

UPDATE vehicles SET "variant"='FE320HP 6X4 CAB/CHASSIS', "vin"='YV2V001D0NZ141697', odometer=62219, "nextServiceKm"=72000, "linktTag"='163605317144' WHERE id='AVT01';
UPDATE vehicles SET "variant"='FE320HP 6X4 CAB/CHASSIS', "vin"='YV2V001D0PZ147020', odometer=58821, "nextServiceKm"=70000, "linktTag"='232522102242' WHERE id='AVT02';
UPDATE vehicles SET "variant"='FE 6X4 CAB/CHASSIS', "vin"='YV2V001D7LZ131620', odometer=53900, "nextServiceKm"=72000, "linktTag"='240921121747' WHERE id='AVT03';
UPDATE vehicles SET "variant"='300350', "vin"='JALFYH77UP7000267', odometer=13670, "nextServiceKm"=40000, "linktTag"='000 5841484' WHERE id='AVT04';
UPDATE vehicles SET "variant"='6X4DIESEL', "vin"='YV2V001D3RZ153154', "linktTag"='243401695941' WHERE id='AVT05';
UPDATE vehicles SET "variant"='2R3 3 AXLE TRUCK', "vin"='YS2P6X40009359194', "linktTag"='240921344448' WHERE id='AVT06';
UPDATE vehicles SET "variant"='6X4DIESEL', "vin"='YV2VZ60D1TZ164879' WHERE id='AVT07';
UPDATE vehicles SET "variant"='6X4DIESEL', "vin"='YV2VZ6006TZ165042' WHERE id='AVT08';

-- Excavators (AEX01–AEX03)

UPDATE vehicles SET "variant"='SK55SRX EWP PLNT', "vin"='MPBUMFF50KX244072', odometer=150429, "nextServiceKm"=160000, "linktTag"='192306542726', "wrdtPlantNo"='P-0158614' WHERE id='AEX01';
UPDATE vehicles SET "variant"='SK17SR6 EWP PLNT', "vin"='MPBUMFF50KX242073', odometer=160000, "nextServiceKm"=169000, "linktTag"='192306542320' WHERE id='AEX02';
UPDATE vehicles SET "variant"='SK30SR EWP PLNT', "vin"='PW17050578' WHERE id='AEX03';

-- Heavy tippers (AHV01–AHV02)

UPDATE vehicles SET "variant"='FH-FSRCG-L22', "vin"='MPBUMFF50LX276915', odometer=138000, "nextServiceKm"=142000, "linktTag"='193808829322', "wrdtPlantNo"='P-0158611' WHERE id='AHV01';
UPDATE vehicles SET "variant"='FE1426 AIR', "vin"='MPBUMFF50MX320683', "nextServiceKm"=90000, "linktTag"='202607665223' WHERE id='AHV02';

-- 3. Activity log entry
INSERT INTO activity (id, ts, "vehicleId", text)
VALUES ('act-fleet-details', now(), '', 'Fleet details updated: VIN, variant, Linkt tags, odometer readings from Fleet Info sheet');

COMMIT;
