/**
 * ON11 — Bangladesh address reference data for parseBdAddress.
 *
 * Districts: ALL 64, canonical English name + Bengali spelling
 * + common English spelling variants. Thanas/upazilas: a curated
 * list, each mapped to its district (the task's coverage list).
 * Bare "Sadar" and bare "Kotwali" are deliberately NOT single-
 * district thanas: almost every district has a Sadar, and Kotwali
 * exists in several districts — both are entered per-district
 * (e.g. "Khulna Sadar" is not in the curated list; "Kotwali"
 * carries one entry per district that has one, so a lone
 * "Kotwali" resolves as ambiguous, while "Kotwali, Chattogram"
 * resolves through the district match).
 */

export interface DistrictEntry {
  canonical: string;
  bn: string[];
  variants: string[];
}

/** [canonical, bengali, ...english variants] */
const DISTRICT_ROWS: [string, string, ...string[]][] = [
  ["Dhaka", "ঢাকা", "Dacca"],
  ["Faridpur", "ফরিদপুর"],
  ["Gazipur", "গাজীপুর"],
  ["Gopalganj", "গোপালগঞ্জ"],
  ["Jamalpur", "জামালপুর"],
  ["Kishoreganj", "কিশোরগঞ্জ"],
  ["Madaripur", "মাদারীপুর"],
  ["Manikganj", "মানিকগঞ্জ"],
  ["Munshiganj", "মুন্সিগঞ্জ", "Munshigonj"],
  ["Mymensingh", "ময়মনসিংহ", "Mymensing"],
  ["Narayanganj", "নারায়ণগঞ্জ", "Narayangonj", "Narayanganj"],
  ["Narsingdi", "নরসিংদী"],
  ["Netrokona", "নেত্রকোণা", "Netrokona", "নেত্রকোনা"],
  ["Rajbari", "রাজবাড়ী"],
  ["Shariatpur", "শরীয়তপুর", "Shariatpur", "Sariatpur"],
  ["Sherpur", "শেরপুর"],
  ["Tangail", "টাঙ্গাইল"],
  ["Bogura", "বগুড়া", "Bogra"],
  ["Joypurhat", "জয়পুরহাট"],
  ["Naogaon", "নওগাঁ"],
  ["Natore", "নাটোর"],
  ["Chapainawabganj", "চাঁপাইনবাবগঞ্জ", "Chapainawabganj", "Chapai Nawabganj", "Nawabganj"],
  ["Pabna", "পাবনা"],
  ["Rajshahi", "রাজশাহী"],
  ["Sirajganj", "সিরাজগঞ্জ", "Sirajgonj"],
  ["Dinajpur", "দিনাজপুর"],
  ["Gaibandha", "গাইবান্ধা"],
  ["Kurigram", "কুড়িগ্রাম"],
  ["Lalmonirhat", "লালমনিরহাট"],
  ["Nilphamari", "নীলফামারী"],
  ["Panchagarh", "পঞ্চগড়"],
  ["Rangpur", "রংপুর"],
  ["Thakurgaon", "ঠাকুরগাঁও"],
  ["Barguna", "বরগুনা"],
  ["Barishal", "বরিশাল", "Barisal"],
  ["Bhola", "ভোলা"],
  ["Jhalokati", "ঝালকাঠি", "Jhalakathi", "Jhalokathi"],
  ["Patuakhali", "পটুয়াখালী"],
  ["Pirojpur", "পিরোজপুর"],
  ["Bandarban", "বান্দরবান"],
  ["Brahmanbaria", "ব্রাহ্মণবাড়িয়া", "Brahmanbaria", "B Baria"],
  ["Chandpur", "চাঁদপুর"],
  ["Chattogram", "চট্টগ্রাম", "Chittagong"],
  ["Cumilla", "কুমিল্লা", "Comilla"],
  ["Cox's Bazar", "কক্সবাজার", "Cox Bazar", "Coxs Bazar", "Cox's Bazar", "কক্সবাজার"],
  ["Feni", "ফেনী"],
  ["Khagrachhari", "খাগড়াছড়ি", "Khagrachari", "Khagrachhari"],
  ["Lakshmipur", "লক্ষ্মীপুর", "Laxmipur"],
  ["Noakhali", "নোয়াখালী"],
  ["Rangamati", "রাঙ্গামাটি"],
  ["Bagerhat", "বাগেরহাট"],
  ["Chuadanga", "চুয়াডাঙ্গা"],
  ["Jashore", "যশোর", "Jessore"],
  ["Jhenaidah", "ঝিনাইদহ", "Jhenaidah", "Jhenaida"],
  ["Khulna", "খুলনা"],
  ["Kushtia", "কুষ্টিয়া"],
  ["Magura", "মাগুরা"],
  ["Meherpur", "মেহেরপুর"],
  ["Narail", "নড়াইল"],
  ["Satkhira", "সাতক্ষীরা"],
  ["Habiganj", "হবিগঞ্জ"],
  ["Moulvibazar", "মৌলভীবাজার", "Moulvibazar", "Maulvibazar"],
  ["Sunamganj", "সুনামগঞ্জ"],
  ["Sylhet", "সিলেট"],
];

export const BD_DISTRICT_ENTRIES: DistrictEntry[] = DISTRICT_ROWS.map(([canonical, bn, ...variants]) => ({
  canonical,
  bn: [bn],
  variants,
}));

export interface ThanaEntry {
  name: string;
  district: string;
  bn?: string;
}

/** [thana name, district canonical, bengali?] */
const THANA_ROWS: [string, string, string?][] = [
  // Dhaka metro + Dhaka district upazilas
  ["Mirpur", "Dhaka", "মিরপুর"],
  ["Pallabi", "Dhaka", "পল্লবী"],
  ["Uttara", "Dhaka", "উত্তরা"],
  ["Dhanmondi", "Dhaka", "ধানমন্ডি"],
  ["Mohammadpur", "Dhaka", "মোহাম্মদপুর"],
  ["Gulshan", "Dhaka", "গুলশান"],
  ["Banani", "Dhaka", "বনানী"],
  ["Badda", "Dhaka", "বাড্ডা"],
  ["Jatrabari", "Dhaka", "যাত্রাবাড়ী"],
  ["Demra", "Dhaka", "ডেমরা"],
  ["Keraniganj", "Dhaka", "কেরানীগঞ্জ"],
  ["Savar", "Dhaka", "সাভার"],
  ["Ashulia", "Dhaka", "আশুলিয়া"],
  ["Tejgaon", "Dhaka", "তেজগাঁও"],
  ["Motijheel", "Dhaka", "মতিঝিল"],
  ["Lalbagh", "Dhaka", "লালবাগ"],
  ["Khilgaon", "Dhaka", "খিলগাঁও"],
  ["Rampura", "Dhaka", "রামপুরা"],
  ["Kafrul", "Dhaka", "কাফরুল"],
  ["Turag", "Dhaka", "তুরাগ"],
  ["Dakshinkhan", "Dhaka", "দক্ষিণখান"],
  ["Uttarkhan", "Dhaka", "উত্তরখান"],
  ["Sabujbagh", "Dhaka", "সবুজবাগ"],
  ["Shyampur", "Dhaka", "শ্যামপুর"],
  ["Kamrangirchar", "Dhaka", "কামরাঙ্গীরচর"],
  ["Hazaribagh", "Dhaka", "হাজারীবাগ"],
  ["Adabor", "Dhaka", "আদাবর"],
  ["Darus Salam", "Dhaka", "দারুস সালাম"],
  ["Sher-e-Bangla Nagar", "Dhaka"],
  ["New Market", "Dhaka", "নিউ মার্কেট"],
  ["Ramna", "Dhaka", "রমনা"],
  ["Shahbagh", "Dhaka", "শাহবাগ"],
  ["Paltan", "Dhaka", "পল্টন"],
  ["Wari", "Dhaka", "ওয়ারী"],
  ["Sutrapur", "Dhaka", "সূত্রাপুর"],
  ["Kotwali", "Dhaka"],
  ["Bangshal", "Dhaka", "বংশাল"],
  ["Chawkbazar", "Dhaka", "চকবাজার"],
  ["Gendaria", "Dhaka", "গেন্ডারিয়া"],
  // Gazipur
  ["Gazipur Sadar", "Gazipur"],
  ["Tongi", "Gazipur", "টঙ্গী"],
  ["Kaliakair", "Gazipur", "কালিয়াকৈর"],
  // Narayanganj
  ["Narayanganj Sadar", "Narayanganj"],
  ["Fatullah", "Narayanganj", "ফতুল্লা"],
  ["Siddhirganj", "Narayanganj", "সিদ্ধিরগঞ্জ"],
  // Chattogram
  ["Pahartali", "Chattogram", "পাহাড়তলী"],
  ["Halishahar", "Chattogram", "হালিশহর"],
  ["Kotwali", "Chattogram"],
  ["Panchlaish", "Chattogram", "পাঁচলাইশ"],
  ["Chandgaon", "Chattogram", "চান্দগাঁও"],
  ["Bayezid", "Chattogram", "বায়েজিদ"],
  ["Patiya", "Chattogram", "পটিয়া"],
  ["Rangunia", "Chattogram", "রাঙ্গুনিয়া"],
  ["Hathazari", "Chattogram", "হাটহাজারী"],
  ["Sitakunda", "Chattogram", "সীতাকুণ্ড"],
  // Khulna
  ["Sonadanga", "Khulna", "সোনাডাঙ্গা"],
  ["Khalishpur", "Khulna", "খালিশপুর"],
  ["Daulatpur", "Khulna", "দৌলতপুর"],
  ["Khan Jahan Ali", "Khulna"],
  ["Batiaghata", "Khulna", "বাটিয়াঘাটা"],
  ["Dumuria", "Khulna", "ডুমুরিয়া"],
  // Rajshahi
  ["Boalia", "Rajshahi", "বোয়ালিয়া"],
  ["Rajpara", "Rajshahi", "রাজপাড়া"],
  ["Motihar", "Rajshahi", "মতিহার"],
  ["Shah Makhdum", "Rajshahi"],
  ["Paba", "Rajshahi", "পবা"],
  // Barishal
  ["Barishal Sadar", "Barishal"],
  ["Kotwali", "Barishal"],
  ["Babuganj", "Barishal", "বাবুগঞ্জ"],
  // Sylhet
  ["Sylhet Sadar", "Sylhet"],
  ["Kotwali", "Sylhet"],
  ["Beanibazar", "Sylhet", "বিয়ানীবাজার"],
  ["Golapganj", "Sylhet", "গোলাপগঞ্জ"],
  // Rangpur
  ["Rangpur Sadar", "Rangpur"],
  ["Kotwali", "Rangpur"],
  ["Mithapukur", "Rangpur", "মিঠাপুকুর"],
  // Mymensingh
  ["Mymensingh Sadar", "Mymensingh"],
  ["Kotwali", "Mymensingh"],
  ["Trishal", "Mymensingh", "ত্রিশাল"],
  // Cumilla
  ["Cumilla Sadar", "Cumilla"],
  ["Adarsha Sadar", "Cumilla"],
  ["Daudkandi", "Cumilla", "দাউদকান্দি"],
  // District sadar thanas / upazilas
  ["Cox's Bazar Sadar", "Cox's Bazar"],
  ["Brahmanbaria Sadar", "Brahmanbaria"],
  ["Feni Sadar", "Feni"],
  ["Jashore Sadar", "Jashore"],
  ["Kotwali", "Jashore"],
  ["Dinajpur Sadar", "Dinajpur"],
  ["Tangail Sadar", "Tangail"],
  ["Faridpur Sadar", "Faridpur"],
  ["Kushtia Sadar", "Kushtia"],
  ["Bogura Sadar", "Bogura"],
  ["Naogaon Sadar", "Naogaon"],
  ["Pabna Sadar", "Pabna"],
  ["Sirajganj Sadar", "Sirajganj"],
  ["Jamalpur Sadar", "Jamalpur"],
  ["Sudharam", "Noakhali", "সুধারাম"],
  ["Narsingdi Sadar", "Narsingdi"],
  ["Gopalganj Sadar", "Gopalganj"],
  ["Madaripur Sadar", "Madaripur"],
  ["Shariatpur Sadar", "Shariatpur"],
  ["Chandpur Sadar", "Chandpur"],
  ["Lakshmipur Sadar", "Lakshmipur"],
  ["Bhola Sadar", "Bhola"],
  ["Pirojpur Sadar", "Pirojpur"],
  ["Jhalokati Sadar", "Jhalokati"],
  ["Patuakhali Sadar", "Patuakhali"],
  ["Barguna Sadar", "Barguna"],
  ["Habiganj Sadar", "Habiganj"],
  ["Moulvibazar Sadar", "Moulvibazar"],
  ["Sunamganj Sadar", "Sunamganj"],
  ["Rajbari Sadar", "Rajbari"],
  ["Magura Sadar", "Magura"],
  ["Narail Sadar", "Narail"],
  ["Chuadanga Sadar", "Chuadanga"],
  ["Meherpur Sadar", "Meherpur"],
  ["Satkhira Sadar", "Satkhira"],
  ["Bagerhat Sadar", "Bagerhat"],
  ["Nilphamari Sadar", "Nilphamari"],
  ["Lalmonirhat Sadar", "Lalmonirhat"],
  ["Kurigram Sadar", "Kurigram"],
  ["Gaibandha Sadar", "Gaibandha"],
  ["Thakurgaon Sadar", "Thakurgaon"],
  ["Panchagarh Sadar", "Panchagarh"],
  ["Sherpur Sadar", "Sherpur"],
  ["Netrokona Sadar", "Netrokona"],
  ["Kishoreganj Sadar", "Kishoreganj"],
  ["Manikganj Sadar", "Manikganj"],
  ["Munshiganj Sadar", "Munshiganj"],
  ["Rangamati Sadar", "Rangamati"],
  ["Khagrachhari Sadar", "Khagrachhari"],
  ["Bandarban Sadar", "Bandarban"],
];

export const BD_THANA_ENTRIES: ThanaEntry[] = THANA_ROWS.map(([name, district, bn]) => ({ name, district, bn }));
