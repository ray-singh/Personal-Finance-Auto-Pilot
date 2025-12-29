/**
 * Smart Categorization Module
 * 
 * Enhanced merchant/payee categorization with:
 * - Merchant name normalization
 * - Rule-based pattern matching (fast, free)
 * - AI-powered fallback using OpenAI (accurate, handles edge cases)
 * - Confidence scoring
 * - Learning from user corrections
 */

import { OpenAI } from 'openai'
import { getCategoryRules, insertCategoryRule } from './db/queries'

// Available categories for the system
export const CATEGORIES = [
  'Coffee',
  'Groceries', 
  'Dining',
  'Transportation',
  'Gas',
  'Entertainment',
  'Shopping',
  'Healthcare',
  'Fitness',
  'Utilities',
  'Insurance',
  'Subscriptions',
  'Travel',
  'Education',
  'Personal Care',
  'Pets',
  'Home',
  'Transfer',
  'Cash Withdrawal',
  'Fees',
  'Income',
  'Other'
] as const

export type Category = typeof CATEGORIES[number]

export interface CategorizationResult {
  category: Category
  confidence: 'high' | 'medium' | 'low'
  method: 'rule' | 'pattern' | 'ai' | 'fallback'
  normalizedMerchant: string
  suggestRule?: boolean // True if we should offer to create a rule
}

// Common merchant prefixes to strip for normalization
const MERCHANT_PREFIXES = [
  'SQ *', 'SQU*', 'SQ*',           // Square
  'TST*', 'TOAST*',                 // Toast POS
  'PP*', 'PAYPAL *',                // PayPal
  'AMZN ', 'AMAZON.COM*', 'AMZ*',   // Amazon
  'GOOGLE *', 'GOOGLE*',            // Google
  'APPLE.COM/', 'APPLE *',          // Apple
  'SP ', 'SP*',                     // Stripe/Shopify
  'CKE*', 'CHK*',                   // Check payments
  'POS ',                           // Point of Sale
  'DEBIT ',                         // Debit card
  'PURCHASE ',                      // Purchase
  'ACH ',                           // ACH transfers
  'CHECKCARD ',                     // Check card
  'RECURRING ',                     // Recurring payments
]

// Common suffixes to strip
const MERCHANT_SUFFIXES = [
  ' LLC', ' INC', ' CORP', ' CO', ' LTD',
  ' #\\d+',                          // Store numbers like #1234
  ' \\d{3,}',                        // Long numbers
  ' [A-Z]{2} \\d{5}',                // State + ZIP
  ' \\d{2}/\\d{2}',                  // Dates MM/DD
]

// Extended pattern matching for categorization
const EXTENDED_PATTERNS: Record<Category, string[]> = {
  'Coffee': ['STARBUCKS', 'COFFEE', 'DUNKIN', 'PEET', 'CARIBOU', 'COSTA', 'TIM HORTON', 'PHILZ', 'BLUE BOTTLE', 'CAFE', 'ESPRESSO', 'DUTCH BROS', 'PEETS'],
  'Groceries': ['WHOLE FOODS', 'SAFEWAY', 'TRADER JOE', 'KROGER', 'WALMART', 'COSTCO', 'ALDI', 'PUBLIX', 'WEGMANS', 'HEB', 'MARKET', 'GROCERY', 'SUPERMARKET', 'FOOD LION', 'GIANT', 'HARRIS TEETER', 'SPROUTS', 'FRESH', 'FOODS', 'INSTACART'],
  'Dining': ['RESTAURANT', 'PIZZA', 'MCDONALD', 'CHIPOTLE', 'SUBWAY', 'BURGER', 'TACO', 'WENDY', 'CHICK-FIL', 'PANERA', 'OLIVE GARDEN', 'APPLEBEE', 'IHOP', 'DENNY', 'GRUBHUB', 'DOORDASH', 'UBEREATS', 'POSTMATES', 'SEAMLESS', 'YELP EAT', 'CHILI', 'OUTBACK', 'RED ROBIN', 'BUFFALO WILD', 'FIVE GUYS', 'IN-N-OUT', 'SHAKE SHACK', 'WINGSTOP', 'DOMINO', 'PAPA JOHN', 'LITTLE CAESAR', 'KFC', 'POPEYE', 'PANDA EXPRESS', 'NOODLES', 'SUSHI', 'RAMEN', 'PHO', 'THAI', 'INDIAN', 'CHINESE', 'MEXICAN', 'ITALIAN', 'GRILL', 'BBQ', 'STEAKHOUSE', 'DINER', 'BISTRO', 'EATERY', 'KITCHEN', 'CANTINA', 'TAVERN', 'PUB', 'BAR & GRILL'],
  'Transportation': ['UBER', 'LYFT', 'TAXI', 'CAB', 'METRO', 'TRANSIT', 'BUS', 'TRAIN', 'AMTRAK', 'PARKING', 'TOLL', 'BIRD', 'LIME', 'SCOOTER'],
  'Gas': ['SHELL', 'CHEVRON', 'EXXON', 'BP ', 'MOBIL', 'TEXACO', 'ARCO', 'CITGO', 'SUNOCO', 'MARATHON', 'VALERO', 'PHILLIPS 66', 'GAS', 'FUEL', 'PETRO', '76 ', 'SPEEDWAY', 'WAWA', 'QUIKTRIP', 'RACETRAC', 'CIRCLE K'],
  'Entertainment': ['NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY', 'HBO', 'AMAZON PRIME', 'APPLE TV', 'YOUTUBE', 'PEACOCK', 'PARAMOUNT', 'MOVIE', 'CINEMA', 'THEATRE', 'THEATER', 'CONCERT', 'TICKETMASTER', 'STUBHUB', 'EVENTBRITE', 'STEAM', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'GAMING', 'AMC ', 'REGAL', 'FANDANGO', 'TWITCH', 'CRUNCHYROLL', 'ESPN'],
  'Shopping': ['TARGET', 'AMAZON', 'EBAY', 'ETSY', 'BEST BUY', 'APPLE STORE', 'IKEA', 'HOME DEPOT', 'LOWES', 'BED BATH', 'MACYS', 'NORDSTROM', 'KOHLS', 'JC PENNEY', 'SEPHORA', 'ULTA', 'NIKE', 'ADIDAS', 'GAP', 'OLD NAVY', 'ZARA', 'H&M', 'FOREVER 21', 'TJ MAXX', 'ROSS', 'MARSHALLS', 'DOLLAR', 'STAPLES', 'OFFICE DEPOT', 'MICHAELS', 'HOBBY LOBBY', 'JOANN', 'LULULEMON', 'FOOT LOCKER', 'FINISH LINE', 'DICKS SPORTING', 'REI ', 'BASS PRO', 'CABELAS'],
  'Healthcare': ['PHARMACY', 'CVS', 'WALGREENS', 'RITE AID', 'DOCTOR', 'HOSPITAL', 'MEDICAL', 'DENTAL', 'VISION', 'OPTOMETRY', 'CLINIC', 'HEALTH', 'URGENT CARE', 'KAISER', 'BLUE CROSS', 'AETNA', 'UNITED HEALTH', 'CIGNA', 'QUEST DIAG', 'LABCORP', 'THERAPY', 'COUNSELING', 'MENTAL HEALTH', 'CHIROPRACT'],
  'Fitness': ['GYM', 'FITNESS', 'PLANET FITNESS', 'LA FITNESS', '24 HOUR FITNESS', 'EQUINOX', 'ORANGETHEORY', 'CROSSFIT', 'YOGA', 'PELOTON', 'CLASSPASS', 'ANYTIME FITNESS', 'GOLD GYM', 'LIFETIME', 'YMCA', 'YWCA'],
  'Utilities': ['ELECTRIC', 'GAS BILL', 'WATER', 'SEWER', 'TRASH', 'WASTE', 'COMCAST', 'XFINITY', 'VERIZON', 'AT&T', 'T-MOBILE', 'SPRINT', 'INTERNET', 'CABLE', 'PG&E', 'SOUTHERN CALIFORNIA EDISON', 'CON EDISON', 'DUKE ENERGY', 'DOMINION', 'NATIONAL GRID'],
  'Insurance': ['INSURANCE', 'GEICO', 'STATE FARM', 'ALLSTATE', 'PROGRESSIVE', 'LIBERTY MUTUAL', 'FARMERS', 'USAA', 'NATIONWIDE', 'AFLAC', 'METLIFE', 'PRUDENTIAL'],
  'Subscriptions': ['SUBSCRIPTION', 'MEMBERSHIP', 'ADOBE', 'MICROSOFT', 'DROPBOX', 'ICLOUD', 'GOOGLE STORAGE', 'GOOGLE ONE', 'MEDIUM', 'SUBSTACK', 'PATREON', 'GITHUB', 'NOTION', 'SLACK', 'ZOOM', 'CANVA', 'GRAMMARLY', 'LASTPASS', '1PASSWORD', 'DASHLANE', 'VPN', 'NORDVPN', 'EXPRESSVPN', 'AUDIBLE', 'KINDLE'],
  'Travel': ['AIRLINE', 'UNITED', 'DELTA', 'AMERICAN AIRLINES', 'SOUTHWEST', 'JETBLUE', 'SPIRIT', 'FRONTIER', 'HOTEL', 'MARRIOTT', 'HILTON', 'HYATT', 'AIRBNB', 'VRBO', 'BOOKING', 'EXPEDIA', 'KAYAK', 'TRIVAGO', 'HERTZ', 'ENTERPRISE', 'AVIS', 'BUDGET', 'NATIONAL CAR', 'ALAMO', 'TURO', 'CRUISE'],
  'Education': ['UNIVERSITY', 'COLLEGE', 'SCHOOL', 'TUITION', 'COURSERA', 'UDEMY', 'SKILLSHARE', 'MASTERCLASS', 'LINKEDIN LEARNING', 'DUOLINGO', 'BOOKS', 'TEXTBOOK', 'CHEGG', 'QUIZLET', 'KHAN ACADEMY', 'CODECADEMY', 'UDACITY', 'EDX', 'PLURALSIGHT'],
  'Personal Care': ['SALON', 'BARBER', 'HAIR', 'SPA', 'MASSAGE', 'NAIL', 'BEAUTY', 'WAXING', 'LASER', 'DERMATOLOG', 'SKINCARE', 'COSMETIC'],
  'Pets': ['PETCO', 'PETSMART', 'VET', 'VETERINARY', 'PET SUPPLIES', 'CHEWY', 'BANFIELD', 'PET FOOD', 'GROOMING'],
  'Home': ['RENT', 'MORTGAGE', 'PROPERTY', 'MAINTENANCE', 'REPAIR', 'PLUMBER', 'ELECTRICIAN', 'CLEANING', 'MAID', 'HOUSEKEEPING', 'LANDLORD', 'APARTMENT', 'CONDO', 'HOA'],
  'Transfer': ['VENMO', 'PAYPAL', 'ZELLE', 'CASH APP', 'WIRE', 'ACH', 'TRANSFER', 'SEND MONEY', 'PAYMENT TO', 'PAYMENT FROM'],
  'Cash Withdrawal': ['ATM', 'CASH', 'WITHDRAWAL', 'CASH BACK'],
  'Fees': ['FEE', 'CHARGE', 'OVERDRAFT', 'LATE FEE', 'SERVICE CHARGE', 'MAINTENANCE FEE', 'MONTHLY FEE', 'ANNUAL FEE', 'INTEREST CHARGE', 'FINANCE CHARGE'],
  'Income': ['PAYROLL', 'SALARY', 'DEPOSIT', 'DIRECT DEP', 'INTEREST', 'DIVIDEND', 'REFUND', 'REIMBURSEMENT', 'BONUS', 'COMMISSION', 'INCOME', 'CREDIT', 'CASHBACK', 'REWARD'],
  'Other': []
}

/**
 * Normalize merchant name by stripping common prefixes/suffixes
 * and cleaning up formatting
 */
export function normalizeMerchant(description: string): string {
  let normalized = description.toUpperCase().trim()
  
  // Remove common prefixes
  for (const prefix of MERCHANT_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).trim()
    }
  }
  
  // Remove common suffixes using regex
  for (const suffix of MERCHANT_SUFFIXES) {
    const regex = new RegExp(suffix + '$', 'i')
    normalized = normalized.replace(regex, '').trim()
  }
  
  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim()
  
  // Remove trailing numbers that look like transaction IDs
  normalized = normalized.replace(/\s+\d{4,}$/, '').trim()
  
  // Remove city/state if at the end (e.g., "STARBUCKS SAN FRANCISCO CA")
  normalized = normalized.replace(/\s+[A-Z]{2,}\s+[A-Z]{2}$/, '').trim()
  
  return normalized
}

/**
 * Pattern-based categorization (fast, no API calls)
 */
export async function categorizeByPattern(description: string): Promise<CategorizationResult | null> {
  const normalizedMerchant = normalizeMerchant(description)
  const upperDesc = normalizedMerchant.toUpperCase()
  
  // First check user-defined rules in database (highest priority)
  const rules = await getCategoryRules()
  for (const rule of rules) {
    if (upperDesc.includes(rule.pattern.toUpperCase())) {
      return {
        category: rule.category as Category,
        confidence: 'high',
        method: 'rule',
        normalizedMerchant,
      }
    }
  }
  
  // Then check extended patterns
  for (const [category, patterns] of Object.entries(EXTENDED_PATTERNS)) {
    for (const pattern of patterns) {
      if (upperDesc.includes(pattern)) {
        return {
          category: category as Category,
          confidence: 'high',
          method: 'pattern',
          normalizedMerchant,
        }
      }
    }
  }
  
  // Check for common payment processor patterns
  if (description.toUpperCase().startsWith('SQ *') || description.toUpperCase().startsWith('SQU*')) {
    // Square - could be anything, suggest AI categorization
    return null
  }
  
  if (description.toUpperCase().startsWith('TST*') || description.toUpperCase().startsWith('TOAST*')) {
    return {
      category: 'Dining',
      confidence: 'medium',
      method: 'pattern',
      normalizedMerchant,
    }
  }
  
  return null
}

/**
 * AI-powered categorization using OpenAI
 * Only called when pattern matching fails
 */
export async function categorizeByAI(description: string, normalizedMerchant: string): Promise<CategorizationResult> {
  // Check if OpenAI is configured
  if (!process.env.OPENAI_API_KEY) {
    return {
      category: 'Other',
      confidence: 'low',
      method: 'fallback',
      normalizedMerchant,
      suggestRule: true,
    }
  }
  
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a financial transaction categorizer. Given a merchant/payee name, determine the most appropriate category.

Available categories: ${CATEGORIES.join(', ')}

Rules:
- Respond with ONLY the category name, nothing else
- If unsure, choose the closest match
- For ambiguous merchants, consider what they're most commonly known for
- "Other" should only be used as a last resort`
        },
        {
          role: 'user',
          content: `Categorize this transaction: "${description}"
Normalized merchant: "${normalizedMerchant}"`
        }
      ],
      temperature: 0,
      max_tokens: 20,
    })
    
    const aiCategory = response.choices[0].message.content?.trim() || 'Other'
    
    // Validate the AI response is a valid category
    const validCategory = CATEGORIES.includes(aiCategory as Category) 
      ? (aiCategory as Category)
      : 'Other'
    
    return {
      category: validCategory,
      confidence: validCategory === 'Other' ? 'low' : 'medium',
      method: 'ai',
      normalizedMerchant,
      suggestRule: true, // Suggest creating a rule for AI-categorized transactions
    }
  } catch (error) {
    console.error('AI categorization failed:', error)
    return {
      category: 'Other',
      confidence: 'low',
      method: 'fallback',
      normalizedMerchant,
      suggestRule: true,
    }
  }
}

/**
 * Smart categorization - tries pattern matching first, falls back to AI
 */
export async function smartCategorize(description: string): Promise<CategorizationResult> {
  // Try pattern-based first (fast, free)
  const patternResult = await categorizeByPattern(description)
  if (patternResult) {
    return patternResult
  }
  
  // Fall back to AI categorization
  const normalizedMerchant = normalizeMerchant(description)
  return categorizeByAI(description, normalizedMerchant)
}

/**
 * Learn from user correction - optionally create a new rule
 */
export async function learnFromCorrection(
  originalDescription: string,
  correctedCategory: string,
  createRule: boolean = false
): Promise<{ ruleCreated: boolean; pattern?: string }> {
  if (!createRule) {
    return { ruleCreated: false }
  }
  
  const normalizedMerchant = normalizeMerchant(originalDescription)
  
  // Only create rules for normalized merchants that are reasonably specific
  if (normalizedMerchant.length < 3 || normalizedMerchant.length > 50) {
    return { ruleCreated: false }
  }
  
  try {
    await insertCategoryRule({
      pattern: normalizedMerchant,
      category: correctedCategory,
    })
    
    return {
      ruleCreated: true,
      pattern: normalizedMerchant,
    }
  } catch (error: any) {
    // Rule might already exist (conflict)
    if (error.code === '23505') {
      return { ruleCreated: false, pattern: normalizedMerchant }
    }
    console.error('Failed to create category rule:', error)
    return { ruleCreated: false }
  }
}

/**
 * Batch categorize multiple transactions
 * Uses pattern matching for most, AI for unknowns
 */
export async function batchCategorize(
  descriptions: string[]
): Promise<CategorizationResult[]> {
  const results: CategorizationResult[] = []
  const needsAI: { index: number; description: string; normalized: string }[] = []
  
  // First pass: pattern matching
  for (let i = 0; i < descriptions.length; i++) {
    const patternResult = await categorizeByPattern(descriptions[i])
    if (patternResult) {
      results[i] = patternResult
    } else {
      needsAI.push({
        index: i,
        description: descriptions[i],
        normalized: normalizeMerchant(descriptions[i]),
      })
    }
  }
  
  // Second pass: AI for remaining (batched for efficiency)
  if (needsAI.length > 0 && process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      
      // Batch up to 20 at a time
      const batchSize = 20
      for (let i = 0; i < needsAI.length; i += batchSize) {
        const batch = needsAI.slice(i, i + batchSize)
        
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a financial transaction categorizer. Categorize each merchant/payee.

Available categories: ${CATEGORIES.join(', ')}

Respond with a JSON array of category names, one per input merchant, in the same order.
Example: ["Dining", "Shopping", "Coffee"]`
            },
            {
              role: 'user',
              content: `Categorize these merchants:\n${batch.map((b, idx) => `${idx + 1}. ${b.normalized}`).join('\n')}`
            }
          ],
          temperature: 0,
          max_tokens: 200,
        })
        
        try {
          const content = response.choices[0].message.content || '[]'
          const categories = JSON.parse(content) as string[]
          
          for (let j = 0; j < batch.length; j++) {
            const category = (categories[j] && CATEGORIES.includes(categories[j] as Category))
              ? (categories[j] as Category)
              : 'Other'
            
            results[batch[j].index] = {
              category,
              confidence: category === 'Other' ? 'low' : 'medium',
              method: 'ai',
              normalizedMerchant: batch[j].normalized,
              suggestRule: true,
            }
          }
        } catch {
          // Parse failed, fall back to individual categorization
          for (const item of batch) {
            results[item.index] = {
              category: 'Other',
              confidence: 'low',
              method: 'fallback',
              normalizedMerchant: item.normalized,
              suggestRule: true,
            }
          }
        }
      }
    } catch (error) {
      console.error('Batch AI categorization failed:', error)
      // Fill in fallbacks
      for (const item of needsAI) {
        if (!results[item.index]) {
          results[item.index] = {
            category: 'Other',
            confidence: 'low',
            method: 'fallback',
            normalizedMerchant: item.normalized,
            suggestRule: true,
          }
        }
      }
    }
  } else {
    // No OpenAI, use fallback
    for (const item of needsAI) {
      results[item.index] = {
        category: 'Other',
        confidence: 'low',
        method: 'fallback',
        normalizedMerchant: item.normalized,
        suggestRule: true,
      }
    }
  }
  
  return results
}

// Re-export for backward compatibility
export { categorizeTransaction } from './categorization'
