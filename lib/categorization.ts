import { getCategoryRules } from './db/queries'

export interface TransactionRow {
  date: string
  description: string
  amount: number
  [key: string]: any
}

// Extended pattern matching for better autonomous categorization
const EXTENDED_PATTERNS: Record<string, string[]> = {
  'Coffee': ['STARBUCKS', 'COFFEE', 'DUNKIN', 'PEET', 'CARIBOU', 'COSTA', 'TIM HORTON', 'PHILZ', 'BLUE BOTTLE', 'CAFE', 'ESPRESSO'],
  'Groceries': ['WHOLE FOODS', 'SAFEWAY', 'TRADER JOE', 'KROGER', 'WALMART', 'COSTCO', 'ALDI', 'PUBLIX', 'WEGMANS', 'HEB', 'MARKET', 'GROCERY', 'SUPERMARKET', 'FOOD LION', 'GIANT', 'HARRIS TEETER', 'SPROUTS'],
  'Dining': ['RESTAURANT', 'PIZZA', 'MCDONALD', 'CHIPOTLE', 'SUBWAY', 'BURGER', 'TACO', 'WENDY', 'CHICK-FIL', 'PANERA', 'OLIVE GARDEN', 'APPLEBEE', 'IHOP', 'DENNY', 'GRUBHUB', 'DOORDASH', 'UBEREATS', 'POSTMATES', 'SEAMLESS', 'YELP', 'CHILI', 'OUTBACK', 'RED ROBIN', 'BUFFALO WILD', 'FIVE GUYS', 'IN-N-OUT', 'SHAKE SHACK', 'WINGSTOP', 'DOMINO', 'PAPA JOHN', 'LITTLE CAESAR'],
  'Transportation': ['UBER', 'LYFT', 'TAXI', 'CAB', 'METRO', 'TRANSIT', 'BUS', 'TRAIN', 'AMTRAK', 'PARKING', 'TOLL'],
  'Gas': ['SHELL', 'CHEVRON', 'EXXON', 'BP ', 'MOBIL', 'TEXACO', 'ARCO', 'CITGO', 'SUNOCO', 'MARATHON', 'VALERO', 'PHILLIPS 66', 'GAS', 'FUEL', 'PETRO'],
  'Entertainment': ['NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY', 'HBO', 'AMAZON PRIME', 'APPLE TV', 'YOUTUBE', 'PEACOCK', 'PARAMOUNT', 'MOVIE', 'CINEMA', 'THEATRE', 'THEATER', 'CONCERT', 'TICKETMASTER', 'STUBHUB', 'EVENTBRITE', 'STEAM', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'GAMING'],
  'Shopping': ['TARGET', 'AMAZON', 'EBAY', 'ETSY', 'BEST BUY', 'APPLE STORE', 'IKEA', 'HOME DEPOT', 'LOWES', 'BED BATH', 'MACYS', 'NORDSTROM', 'KOHLS', 'JC PENNEY', 'SEPHORA', 'ULTA', 'NIKE', 'ADIDAS', 'GAP', 'OLD NAVY', 'ZARA', 'H&M', 'FOREVER 21', 'TJ MAXX', 'ROSS', 'MARSHALLS'],
  'Healthcare': ['PHARMACY', 'CVS', 'WALGREENS', 'RITE AID', 'DOCTOR', 'HOSPITAL', 'MEDICAL', 'DENTAL', 'VISION', 'OPTOMETRY', 'CLINIC', 'HEALTH', 'URGENT CARE', 'KAISER', 'BLUE CROSS', 'AETNA', 'UNITED HEALTH', 'CIGNA'],
  'Fitness': ['GYM', 'FITNESS', 'PLANET FITNESS', 'LA FITNESS', '24 HOUR FITNESS', 'EQUINOX', 'ORANGETHEORY', 'CROSSFIT', 'YOGA', 'PELOTON', 'CLASSPASS'],
  'Utilities': ['ELECTRIC', 'GAS BILL', 'WATER', 'SEWER', 'TRASH', 'WASTE', 'COMCAST', 'XFINITY', 'VERIZON', 'AT&T', 'T-MOBILE', 'SPRINT', 'INTERNET', 'CABLE', 'PG&E', 'SOUTHERN CALIFORNIA EDISON', 'CON EDISON'],
  'Insurance': ['INSURANCE', 'GEICO', 'STATE FARM', 'ALLSTATE', 'PROGRESSIVE', 'LIBERTY MUTUAL', 'FARMERS', 'USAA', 'NATIONWIDE'],
  'Subscriptions': ['SUBSCRIPTION', 'MEMBERSHIP', 'ADOBE', 'MICROSOFT', 'DROPBOX', 'ICLOUD', 'GOOGLE STORAGE', 'MEDIUM', 'SUBSTACK', 'PATREON', 'GITHUB', 'NOTION', 'SLACK', 'ZOOM'],
  'Travel': ['AIRLINE', 'UNITED', 'DELTA', 'AMERICAN AIRLINES', 'SOUTHWEST', 'JETBLUE', 'SPIRIT', 'FRONTIER', 'HOTEL', 'MARRIOTT', 'HILTON', 'HYATT', 'AIRBNB', 'VRBO', 'BOOKING', 'EXPEDIA', 'KAYAK', 'TRIVAGO', 'HERTZ', 'ENTERPRISE', 'AVIS', 'BUDGET'],
  'Education': ['UNIVERSITY', 'COLLEGE', 'SCHOOL', 'TUITION', 'COURSERA', 'UDEMY', 'SKILLSHARE', 'MASTERCLASS', 'LINKEDIN LEARNING', 'DUOLINGO', 'BOOKS', 'TEXTBOOK'],
  'Personal Care': ['SALON', 'BARBER', 'HAIR', 'SPA', 'MASSAGE', 'NAIL', 'BEAUTY'],
  'Pets': ['PETCO', 'PETSMART', 'VET', 'VETERINARY', 'PET SUPPLIES', 'CHEWY'],
  'Home': ['RENT', 'MORTGAGE', 'PROPERTY', 'MAINTENANCE', 'REPAIR', 'PLUMBER', 'ELECTRICIAN', 'CLEANING', 'MAID', 'HOUSEKEEPING'],
  'Transfer': ['VENMO', 'PAYPAL', 'ZELLE', 'CASH APP', 'WIRE', 'ACH', 'TRANSFER'],
  'Cash Withdrawal': ['ATM', 'CASH', 'WITHDRAWAL'],
  'Fees': ['FEE', 'CHARGE', 'OVERDRAFT', 'LATE FEE', 'SERVICE CHARGE', 'MAINTENANCE FEE'],
  'Income': ['PAYROLL', 'SALARY', 'DEPOSIT', 'DIRECT DEP', 'INTEREST', 'DIVIDEND', 'REFUND', 'REIMBURSEMENT', 'BONUS', 'COMMISSION']
}

/**
 * Autonomous categorization using enhanced pattern matching
 * This function matches transaction descriptions against known patterns
 */
export async function categorizeTransaction(description: string): Promise<string> {
  const rules = await getCategoryRules()
  const upperDesc = description.toUpperCase()

  // First try database rules (user-customizable)
  for (const rule of rules) {
    if (upperDesc.includes(rule.pattern.toUpperCase())) {
      return rule.category
    }
  }

  // Then try extended pattern matching
  for (const [category, patterns] of Object.entries(EXTENDED_PATTERNS)) {
    for (const pattern of patterns) {
      if (upperDesc.includes(pattern)) {
        return category
      }
    }
  }

  // Smart fallback based on common merchant prefixes
  if (upperDesc.startsWith('SQ *') || upperDesc.startsWith('SQU*')) {
    // Square payments - often small businesses
    return 'Shopping'
  }

  if (upperDesc.startsWith('TST*') || upperDesc.startsWith('TOAST*')) {
    // Toast payments - restaurant POS
    return 'Dining'
  }

  // Default category
  return 'Other'
}

/**
 * Determine transaction type based on amount
 */
export function getTransactionType(amount: number): string {
  return amount < 0 ? 'expense' : 'income'
}

/**
 * Parse date from various formats to ISO format
 */
export function parseDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date')
    }
    return date.toISOString().split('T')[0]
  } catch {
    // Return current date as fallback
    return new Date().toISOString().split('T')[0]
  }
}

/**
 * Parse amount from string (handles negative numbers, currency symbols, etc.)
 */
export function parseAmount(amountString: string | number): number {
  if (typeof amountString === 'number') {
    return amountString
  }
  
  // Remove currency symbols and commas
  const cleaned = amountString.replace(/[$,]/g, '').trim()
  const amount = parseFloat(cleaned)
  
  return isNaN(amount) ? 0 : amount
}
