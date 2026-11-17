// Registro central de contas do Magnetic Funnels Hub v2.
// LISTA DEFINITIVA v2, fechada em 2026-11-16 cruzando Notion (Central de
// Clientes), WorkDrive (Clients > Projects > Clients), o Hub atual do
// Lovable e a conexão HighLevel. Aprovada pelo Lucas em 2026-11-16.
// NENHUMA chave fica neste arquivo: contas com location própria apontam
// para a variável de ambiente que o Lucas preenche no Vercel.
// Contas sem location têm sourceStatus "mapear": a fonte dos leads
// (subconta, pipeline ou sistema) ainda será definida com o Lucas.

export type AccountKind = "empresa" | "comunidade" | "cliente" | "projeto" | "potencial";
export type SourceStatus = "hl-location" | "hl-conexao" | "propria" | "mapear" | "sem-subconta";

export interface Account {
  slug: string;
  name: string;
  kind: AccountKind;
  locationId: string | null;
  pitEnv: string | null;
  site: string | null;
  sourceStatus: SourceStatus;
  inNotion: boolean;
  inWorkDrive: boolean;
  note?: string;
}

export const ACCOUNTS: Account[] = [
  // ===== Empresa e comunidade =====
  { slug: "magnetic-funnels-us", name: "Magnetic Funnels (US)", kind: "empresa", locationId: "FDjzUx1WHAiy53Cftfpz", pitEnv: "HL_PIT_MAGNETIC_FUNNELS_US", site: "https://magneticfunnels.io", sourceStatus: "hl-location", inNotion: true, inWorkDrive: true },
  { slug: "comunidade-magnetic-flows", name: "Comunidade Magnetic Flows (Brasil)", kind: "comunidade", locationId: "hZ7ygpwbjzq0ncNYlZKp", pitEnv: "HL_PIT_COMUNIDADE_MAGNETIC_FLOWS", site: null, sourceStatus: "hl-location", inNotion: true, inWorkDrive: true },
  { slug: "magnetic-flows-community", name: "Magnetic Flows Community (QC)", kind: "comunidade", locationId: "pt3gJXJbn6f5LGg33i4U", pitEnv: "HL_PIT_MAGNETIC_FLOWS_COMMUNITY", site: null, sourceStatus: "hl-location", inNotion: false, inWorkDrive: false, note: "Conteúdo QC e SMS da House Cleaning" },

  // ===== Clientes (12, após exclusões do Lucas em 2026-11-16: saíram Kingstons, Funnel AI, i9 Ponto, Smokin Willies, Dare To Be Different e Hiett Benefits) =====
  { slug: "the-bar-aesthetics", name: "The Bar Aesthetics & Wellness", kind: "cliente", locationId: "uBtKBbMsYRoMDDQbRYor", pitEnv: "HL_PIT_THE_BAR_AESTHETICS", site: null, sourceStatus: "hl-location", inNotion: true, inWorkDrive: true },
  { slug: "sumthin-different", name: "Sumthin' Different Barber & Beauty", kind: "cliente", locationId: "Tsdq63dVjuvy3u927u7h", pitEnv: "HL_PIT_SUMTHIN_DIFFERENT", site: null, sourceStatus: "hl-location", inNotion: true, inWorkDrive: true },
  { slug: "fresh-air-movement", name: "Fresh Air Movement", kind: "cliente", locationId: null, pitEnv: null, site: "https://freshairmovement.org", sourceStatus: "mapear", inNotion: true, inWorkDrive: true, note: "Cliente ativo, mas SEM conta (Lucas, 2026-11-16): nada ligado ainda" },
  { slug: "corazon-latino", name: "Corazon Latino", kind: "cliente", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },
  { slug: "pee-wees-soul-food", name: "Pee Wee's Soul Food", kind: "cliente", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },
  { slug: "globalaser", name: "Globalaser", kind: "cliente", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },
  { slug: "dr-josiel-peixoto", name: "Dr. Josiel Peixoto", kind: "cliente", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },
  { slug: "blue-steel-auto-body", name: "Blue Steel Auto Body", kind: "cliente", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },
  { slug: "simpson-ltd", name: "Simpson Ltd", kind: "cliente", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },
  { slug: "olivo-taco", name: "Olivo Taco", kind: "cliente", locationId: null, pitEnv: null, site: null, sourceStatus: "sem-subconta", inNotion: true, inWorkDrive: true, note: "Ainda não tem conta (Lucas, 2026-11-16)" },
  { slug: "the-gypsy-highway", name: "The Gypsy Highway", kind: "cliente", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },
  { slug: "mi-rancho", name: "Mi Rancho", kind: "cliente", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },

  // ===== Marcas e projetos próprios =====
  { slug: "food-truck-qc", name: "Food Truck QC", kind: "projeto", locationId: null, pitEnv: null, site: "https://app.foodtruckqc.com", sourceStatus: "propria", inNotion: true, inWorkDrive: true, note: "Fonte: app próprio. Variável reservada: FTQC_API_KEY" },
  { slug: "saazid", name: "SAAZID", kind: "projeto", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },
  { slug: "qc-digital", name: "Quad Cities Digital", kind: "projeto", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true },
  { slug: "qc-aesthetics", name: "Quad Cities Aesthetics", kind: "projeto", locationId: "8XFDAaPDyWi190LwqxvT", pitEnv: "HL_PIT_QC_AESTHETICS", site: null, sourceStatus: "hl-location", inNotion: true, inWorkDrive: true },
  { slug: "qc-home-renovation", name: "Quad Cities Home Renovation", kind: "projeto", locationId: "d2Wetxz6eTgmNdMndEeN", pitEnv: "HL_PIT_QC_HOME_RENOVATION", site: "https://quadcitieshomerenovation.com", sourceStatus: "hl-location", inNotion: true, inWorkDrive: true },
  { slug: "qc-house-cleaning", name: "Quad Cities House Cleaning", kind: "projeto", locationId: "l2HYV5tTmRrsMFDRhe13", pitEnv: "HL_PIT_QC_HOUSE_CLEANING", site: "https://quadcitieshousecleaning.com", sourceStatus: "hl-location", inNotion: true, inWorkDrive: true },
  { slug: "qc-electric", name: "Quad Cities Electric (com HVAC)", kind: "projeto", locationId: null, pitEnv: "HL_PIT_QC_ELECTRIC", site: "https://quadcitieselectrician.com", sourceStatus: "sem-subconta", inNotion: true, inWorkDrive: true },
  { slug: "qc-landscaping", name: "Quad Cities Landscaping (com Tree Service)", kind: "projeto", locationId: null, pitEnv: "HL_PIT_QC_LANDSCAPING", site: "https://quadcitieslawncare.com", sourceStatus: "sem-subconta", inNotion: true, inWorkDrive: true },
  { slug: "clientes-nos-eua", name: "Clientes nos EUA", kind: "projeto", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: true, note: "Programa de agentes de voz (Juscivan)" },
  { slug: "wrexham-brasil", name: "Wrexham Brasil", kind: "projeto", locationId: null, pitEnv: null, site: null, sourceStatus: "mapear", inNotion: true, inWorkDrive: false },
  { slug: "muscatine-tree-service", name: "Muscatine Tree Service", kind: "projeto", locationId: "SFuOaZw2occIPJjkI7bA", pitEnv: "HL_PIT_MUSCATINE_TREE_SERVICE", site: null, sourceStatus: "hl-location", inNotion: false, inWorkDrive: false, note: "Só existe no Hub atual, grupo Lead Generation" },

  // ===== Potenciais, fora do MVP =====
  { slug: "crystals-nails", name: "Crystal's Nails and Spa", kind: "potencial", locationId: "1QBWz8q9QYRs4kPqHmQE", pitEnv: null, site: null, sourceStatus: "hl-location", inNotion: false, inWorkDrive: false },
  { slug: "golicks-meat-market", name: "Golick's Meat Market", kind: "potencial", locationId: "4NzkIKItkR3sZAy9lFn9", pitEnv: null, site: null, sourceStatus: "hl-location", inNotion: false, inWorkDrive: false },
  { slug: "hoangh-ahn-foods", name: "Hoangh-Ahn Foods", kind: "potencial", locationId: "39DqGqeLPaCTQwlTvqLi", pitEnv: null, site: null, sourceStatus: "hl-location", inNotion: false, inWorkDrive: false },
  { slug: "mikes-vacuum-center", name: "Mike's Vacuum Center", kind: "potencial", locationId: "ZDd6TnWrYAQ9R5VkLoqP", pitEnv: null, site: null, sourceStatus: "hl-location", inNotion: false, inWorkDrive: false },
];

/** Regras iniciais de leads fakes: quem casa aqui nasce fora das métricas. */
export const FAKE_NAME_PATTERNS: string[] = [
  "american express",
  "verizon",
  "better business bureau",
  "bbb",
];

/** Origens que contam como lead de verdade. Email inbound avulso NÃO conta. */
export const REAL_LEAD_SOURCES = ["form", "calendar", "chat", "workflow", "survey", "quiz"] as const;
