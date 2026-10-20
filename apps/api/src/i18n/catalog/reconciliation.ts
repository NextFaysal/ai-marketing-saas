/**
 * MB4 (ML10) — reconciliation catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the reconciliation module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const reconciliationCatalog: CatalogNamespace = {
  "reconciliation.noHeaderWasFoundInThe": {
    bn: "CSV ফাইলে header পাওয়া যায়নি",
    en: "No header was found in the CSV file",
  },
  "reconciliation.thereIsNoDataRowIn": {
    bn: "CSV ফাইলে কোনো data row নেই",
    en: "There is no data row in the CSV file",
  },
  "reconciliation.courierIntegrationNotFoundInThis": {
    bn: "এই organization-এ courier integration পাওয়া যায়নি",
    en: "Courier integration not found in this organization",
  },
  "reconciliation.matchedShipmentNotFoundInThis": {
    bn: "এই organization-এ matched shipment পাওয়া যায়নি",
    en: "Matched shipment not found in this organization",
  },
  "reconciliation.reconciliationImportNotFoundInThis": {
    bn: "এই organization-এ reconciliation import পাওয়া যায়নি",
    en: "Reconciliation import not found in this organization",
  },
  "reconciliation.reconciliationLineNotFoundInThis": {
    bn: "এই organization-এ reconciliation line পাওয়া যায়নি",
    en: "Reconciliation line not found in this organization",
  },
  "reconciliation.isRequiredInColumnMappingIt": {
    bn: "column mapping-এ {{key}} আবশ্যক — খালি রাখা যাবে না",
    en: "{{key}} is required in column mapping — it cannot be left empty",
  },
  "reconciliation.columnMappingSMustBeA": {
    bn: "column mapping-এর {{key}} অবশ্যই header-এর নাম (string) হতে হবে",
    en: "column mapping's {{key}} must be a header name (string)",
  },
  "reconciliation.theMappingColumnWasNotFound": {
    bn: "mapping-এর কলাম পাওয়া যায়নি: {{col}}",
    en: "The mapping column was not found: {{col}}",
  },
  "reconciliation.unknownActionGiveAcceptSheetOr": {
    bn: "অজানা action: {{dtoAction}} — \"accept_sheet\" বা \"mark_reviewed\" দিন",
    en: "Unknown action: {{dtoAction}} — give \"accept_sheet\" or \"mark_reviewed\"",
  },
  "reconciliation.thisIntegrationIsNotACourier": {
    bn: "এই integration-টি কুরিয়ার অ্যাকাউন্ট নয় — শুধু steadfast, pathao বা redx কুরিয়ারের শিট import করা যাবে",
    en: "This integration is not a courier account — only steadfast, pathao or redx courier sheets can be imported",
  },
  "reconciliation.columnMappingIsNotSetFor": {
    bn: "এই কুরিয়ারের জন্য column mapping সেট করা হয়নি — আগে mapping দিন",
    en: "Column mapping is not set for this courier — give the mapping first",
  },
  "reconciliation.thisFileHasAlreadyBeenImported": {
    bn: "এই ফাইলটি আগেই import করা হয়েছে",
    en: "This file has already been imported",
  },
  "reconciliation.thisRowHasNoMatchedShipment": {
    bn: "এই সারিতে matched shipment বা শিটের অ্যামাউন্ট নেই — accept করা যাবে না",
    en: "This row has no matched shipment or sheet amount — it cannot be accepted",
  },
  "reconciliation.atMostRowsCanBeImported": {
    bn: "একবারে সর্বোচ্চ {{MAX_ROWS}} সারি import করা যাবে",
    en: "At most {{MAX_ROWS}} rows can be imported at a time",
  },
};
