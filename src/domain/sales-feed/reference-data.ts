/**
 * Reference data for the clean sales feed: the five sellers and their city-based territories.
 * Seller names come from the maintainer's fictional sample data. City lists were prepared from
 * public geography; sources and caveats are in `docs/sales-feed-contract.md`.
 *
 * Reachable from Node scripts through built-in type stripping, so relative imports keep their
 * `.ts` extension and type-only imports use `import type`.
 */
import type { BusinessUnit } from "../sales-import/types.ts";

export interface TerritoryCity {
  city: string;
  /** Two-letter state code (UF). */
  state: string;
}

export interface SellerReference {
  sellerId: string;
  name: string;
  businessUnit: BusinessUnit;
  territory: string;
  cities: readonly TerritoryCity[];
}

function inState(state: string, cities: readonly string[]): TerritoryCity[] {
  return cities.map((city) => ({ city, state }));
}

// Região Metropolitana de São Paulo (39 municipalities).
const GRANDE_SAO_PAULO = [
  "Arujá", "Barueri", "Biritiba Mirim", "Caieiras", "Cajamar", "Carapicuíba", "Cotia", "Diadema",
  "Embu das Artes", "Embu-Guaçu", "Ferraz de Vasconcelos", "Francisco Morato", "Franco da Rocha",
  "Guararema", "Guarulhos", "Itapecerica da Serra", "Itapevi", "Itaquaquecetuba", "Jandira",
  "Juquitiba", "Mairiporã", "Mauá", "Mogi das Cruzes", "Osasco", "Pirapora do Bom Jesus", "Poá",
  "Ribeirão Pires", "Rio Grande da Serra", "Salesópolis", "Santa Isabel", "Santana de Parnaíba",
  "Santo André", "São Bernardo do Campo", "São Caetano do Sul", "São Lourenço da Serra",
  "São Paulo", "Suzano", "Taboão da Serra", "Vargem Grande Paulista",
];

// São José dos Campos, Campinas and Holambra, plus the municipalities bordering each.
const SJC_CAMPINAS_HOLAMBRA_SP = [
  "São José dos Campos", "Caçapava", "Igaratá", "Jacareí", "Jambeiro", "Joanópolis",
  "Monteiro Lobato",
  "Campinas", "Hortolândia", "Indaiatuba", "Itatiba", "Itupeva", "Jaguariúna", "Monte Mor",
  "Morungaba", "Paulínia", "Pedreira", "Sumaré", "Valinhos",
  "Holambra", "Artur Nogueira", "Cosmópolis", "Mogi Mirim", "Santo Antônio de Posse",
];
const SJC_BORDERING_MG = ["Camanducaia", "Sapucaí-Mirim"];

// Região Serrana: the Rio de Janeiro state government region (15 municipalities).
const REGIAO_SERRANA_RJ = [
  "Bom Jardim", "Cantagalo", "Carmo", "Cordeiro", "Duas Barras", "Macuco", "Miguel Pereira",
  "Nova Friburgo",
  "Petrópolis", "Santa Maria Madalena", "São José do Vale do Rio Preto", "São Sebastião do Alto",
  "Sumidouro", "Teresópolis", "Trajano de Morais",
];

// All 78 municipalities of Espírito Santo.
const ESPIRITO_SANTO = [
  "Afonso Cláudio", "Água Doce do Norte", "Águia Branca", "Alegre", "Alfredo Chaves",
  "Alto Rio Novo", "Anchieta", "Apiacá", "Aracruz", "Atílio Vivácqua", "Baixo Guandu",
  "Barra de São Francisco", "Boa Esperança", "Bom Jesus do Norte", "Brejetuba",
  "Cachoeiro de Itapemirim", "Cariacica", "Castelo", "Colatina", "Conceição da Barra",
  "Conceição do Castelo", "Divino de São Lourenço", "Domingos Martins", "Dores do Rio Preto",
  "Ecoporanga", "Fundão", "Governador Lindenberg", "Guaçuí", "Guarapari", "Ibatiba", "Ibiraçu",
  "Ibitirama", "Iconha", "Irupi", "Itaguaçu", "Itapemirim", "Itarana", "Iúna", "Jaguaré",
  "Jerônimo Monteiro", "João Neiva", "Laranja da Terra", "Linhares", "Mantenópolis", "Marataízes",
  "Marechal Floriano", "Marilândia", "Mimoso do Sul", "Montanha", "Mucurici", "Muniz Freire",
  "Muqui", "Nova Venécia", "Pancas", "Pedro Canário", "Pinheiros", "Piúma", "Ponto Belo",
  "Presidente Kennedy", "Rio Bananal", "Rio Novo do Sul", "Santa Leopoldina",
  "Santa Maria de Jetibá", "Santa Teresa", "São Domingos do Norte", "São Gabriel da Palha",
  "São José do Calçado", "São Mateus", "São Roque do Canaã", "Serra", "Sooretama", "Vargem Alta",
  "Venda Nova do Imigrante", "Viana", "Vila Pavão", "Vila Valério", "Vila Velha", "Vitória",
];

// Mesorregião da Zona da Mata, IBGE 1989 regional division (142 municipalities).
const ZONA_DA_MATA_MINEIRA = [
  "Abre Campo", "Acaiaca", "Além Paraíba", "Alto Caparaó", "Alto Jequitibá", "Alto Rio Doce",
  "Amparo do Serra", "Antônio Prado de Minas", "Aracitaba", "Araponga", "Argirita",
  "Astolfo Dutra", "Barão do Monte Alto", "Barra Longa", "Belmiro Braga", "Bias Fortes", "Bicas",
  "Brás Pires", "Caiana", "Cajuri", "Canaã", "Caparaó", "Caputira", "Carangola", "Cataguases",
  "Chácara", "Chalé", "Chiador", "Cipotânea", "Coimbra", "Coronel Pacheco", "Descoberto",
  "Divinésia", "Divino", "Dom Silvério", "Dona Euzébia", "Dores do Turvo", "Durandé", "Ervália",
  "Espera Feliz", "Estrela Dalva", "Eugenópolis", "Ewbank da Câmara", "Faria Lemos", "Fervedouro",
  "Goianá", "Guaraciaba", "Guarani", "Guarará", "Guidoval", "Guiricema", "Itamarati de Minas",
  "Jequeri", "Juiz de Fora", "Lajinha", "Lamim", "Laranjal", "Leopoldina", "Lima Duarte",
  "Luisburgo", "Manhuaçu", "Manhumirim", "Mar de Espanha", "Maripá de Minas", "Martins Soares",
  "Matias Barbosa", "Matipó", "Mercês", "Miradouro", "Miraí", "Muriaé", "Olaria",
  "Oliveira Fortes", "Oratórios", "Orizânia", "Paiva", "Palma", "Patrocínio do Muriaé",
  "Paula Cândido", "Pedra Bonita", "Pedra do Anta", "Pedra Dourada", "Pedro Teixeira", "Pequeri",
  "Piau", "Piedade de Ponte Nova", "Piranga", "Pirapetinga", "Piraúba", "Ponte Nova",
  "Porto Firme", "Presidente Bernardes", "Raul Soares", "Recreio", "Reduto", "Rio Casca",
  "Rio Doce", "Rio Espera", "Rio Novo", "Rio Pomba", "Rio Preto", "Rochedo de Minas", "Rodeiro",
  "Rosário da Limeira", "Santa Bárbara do Monte Verde", "Santa Cruz do Escalvado",
  "Santa Margarida", "Santa Rita de Ibitipoca", "Santa Rita de Jacutinga", "Santana de Cataguases",
  "Santana do Deserto", "Santana do Manhuaçu", "Santo Antônio do Aventureiro",
  "Santo Antônio do Grama", "Santos Dumont", "São Francisco do Glória", "São Geraldo",
  "São João do Manhuaçu", "São João Nepomuceno", "São José do Mantimento", "São Miguel do Anta",
  "São Pedro dos Ferros", "São Sebastião da Vargem Alegre", "Sem-Peixe", "Senador Cortes",
  "Senador Firmino", "Senhora de Oliveira", "Sericita", "Silveirânia", "Simão Pereira",
  "Simonésia", "Tabuleiro", "Teixeiras", "Tocantins", "Tombos", "Ubá", "Urucânia", "Vermelho Novo",
  "Viçosa", "Vieiras", "Visconde do Rio Branco", "Volta Grande",
];

// Guaxupé and the municipalities bordering it.
const GUAXUPE_MG = ["Guaxupé", "Guaranésia", "Juruaia", "Muzambinho", "São Pedro da União"];
const GUAXUPE_BORDERING_SP = ["Tapiratiba"];

export const SELLERS: readonly SellerReference[] = [
  {
    sellerId: "S01",
    name: "Marcelo Oda",
    businessUnit: "HOME_GARDEN",
    territory: "Grande São Paulo",
    cities: inState("SP", GRANDE_SAO_PAULO),
  },
  {
    sellerId: "S02",
    name: "Sergio Albuquerque",
    businessUnit: "HOME_GARDEN",
    territory: "São José dos Campos, Campinas, Holambra and their bordering cities",
    cities: [...inState("SP", SJC_CAMPINAS_HOLAMBRA_SP), ...inState("MG", SJC_BORDERING_MG)],
  },
  {
    sellerId: "S03",
    name: "Thiago Cruvinel",
    businessUnit: "AGRO",
    territory: "Região Serrana (Rio de Janeiro) and the whole state of Espírito Santo",
    cities: [...inState("RJ", REGIAO_SERRANA_RJ), ...inState("ES", ESPIRITO_SANTO)],
  },
  {
    sellerId: "S04",
    name: "Luis Marcello",
    businessUnit: "AGRO",
    territory: "Zona da Mata Mineira",
    cities: inState("MG", ZONA_DA_MATA_MINEIRA),
  },
  {
    sellerId: "S05",
    name: "Ricardo Gustavo",
    businessUnit: "AGRO",
    territory: "Guaxupé and its bordering cities",
    cities: [...inState("MG", GUAXUPE_MG), ...inState("SP", GUAXUPE_BORDERING_SP)],
  },
];

/** City identity inside a territory: names repeat across states, so the state is part of it. */
export function cityKey(city: string, state: string): string {
  return `${state}/${city}`;
}

export interface FeedSeller {
  seller: SellerReference;
  cityKeys: ReadonlySet<string>;
}

/** Lookup structure the contract validator uses; build once per reference data set. */
export interface FeedReference {
  sellers: ReadonlyMap<string, FeedSeller>;
}

export function buildFeedReference(sellers: readonly SellerReference[]): FeedReference {
  return {
    sellers: new Map(
      sellers.map((seller) => [
        seller.sellerId,
        { seller, cityKeys: new Set(seller.cities.map(({ city, state }) => cityKey(city, state))) },
      ]),
    ),
  };
}

export const DEFAULT_FEED_REFERENCE: FeedReference = buildFeedReference(SELLERS);
