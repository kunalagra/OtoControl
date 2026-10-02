/**
 * Xiaomi / Redmi earbud capabilities and product renders, from the vendor app's own
 * product catalog (`product/get_product_list`, the call behind its device list).
 * GENERATED FILE — regenerate with `python3 scripts/fetch-xiaomi-catalog.py`.
 *
 * Keyed by PID, lowercase hex, as `GetInfo` TLV 3 reports it (VID is always
 * 0x2717). `funcs` are the app's `Function` ids, which the driver gates on;
 * `ncGear` / `tpGear` are the noise-cancelling and transparency strength ids a
 * model offers, in the app's display order; `effects` the EQ preset ids; `taps`
 * the action ids each gesture accepts, keyed by the tap code config 2 uses;
 * `images` one render per colour id (TLV 13). Only URLs and capability data are
 * shipped — no login, key or token reaches the client.
 */

export interface XiaomiTapChoices {
  /** Action ids this gesture accepts, in the app's display order; empty when the catalog lists none. */
  actions: number[];
  /** Long press only: the model offers a noise-control cycle to pick. */
  cycle?: boolean;
}

export interface XiaomiCatalogEntry {
  name: string;
  funcs: number[];
  ncGear?: number[];
  tpGear?: number[];
  effects?: number[];
  taps?: Record<string, XiaomiTapChoices>;
  defaultColour: number;
  images: Record<string, string>;
}

export const XIAOMI_CATALOG: Record<string, XiaomiCatalogEntry> = {
  '5025': {
    name: "Xiaomi Buds 3 Pro",
    funcs: [1001, 1002, 1004, 3002, 3003, 3004, 3005, 4003, 4004, 4005],
    ncGear: [1, 0, 2],
    tpGear: [0, 1],
    taps: {
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/90708c3e946f2fd099f5c2b5a1c176ab-white.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/b04a7b9d94387d5831eaa47979732585-black.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/cefd9e29e3cde57956e44ad06f27fa3c-green.png",
      "4": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/905c3d237b6a587dfdd024e5db4d5e5b-blue.png",
    },
  },
  '5026': {
    name: "Xiaomi Buds 3",
    funcs: [1001, 1004, 1006, 3002, 3003, 3004, 4003, 4004, 4005],
    ncGear: [1, 0, 2, 4],
    tpGear: [0, 1],
    taps: {
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/e182de8e5cefafe4f910885d5029bb26-white.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/2a482c9b56258fd40c44673bf5c0715b-black.png",
    },
  },
  '5027': {
    name: "Redmi Buds 3",
    funcs: [3002, 3008, 4008, 4009, 4010, 5001],
    defaultColour: 0,
    images: {
      "0": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/8fa4c1de99cc08c972f8ec5d25f95cd4-white.png",
    },
  },
  '5034': {
    name: "Redmi Buds 4",
    funcs: [1001, 1002, 1004, 3002, 3008, 3009, 4001, 4002, 4003, 5001],
    ncGear: [1, 0, 2],
    tpGear: [0, 1],
    taps: {
      "1": {
        actions: [1, 2, 3],
      },
      "2": {
        actions: [2, 3, 4, 5],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/aa70a3d4c52f673e029f8150815c1601-white.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/e878d4bd43589589e2fd9eac12416628-black.png",
    },
  },
  '5035': {
    name: "Xiaomi Buds 4 Pro",
    funcs: [1001, 1003, 1005, 2002, 2004, 2007, 2016, 3001, 3002, 3003, 3004, 3005, 4003, 4004, 4005, 4006, 5001],
    ncGear: [0, 1, 2, 3, 4, 5],
    tpGear: [0, 1, 2],
    effects: [0, 6, 5, 1, 11, 12],
    taps: {
      "4": {
        actions: [1],
      },
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 1,
    images: {
      "0": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/4468e86d4d72e00ab4f18a7f2ad78d43-tarnish.png",
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/c0b1a2503b5378aee27081219fc31479-golden.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/4468e86d4d72e00ab4f18a7f2ad78d43-tarnish.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/6b1404aead3b359e8dc375254c2b7b23-silver.png",
    },
  },
  '5044': {
    name: "Xiaomi Buds 4",
    funcs: [1001, 1007, 2002, 2004, 2008, 3002, 3004, 4003, 4004, 4005, 5001],
    ncGear: [1, 0],
    taps: {
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [6, 0],
        cycle: false,
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/b5c18c7b2f6da9faa61e5b964c70c25f-white.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/16d2069d804036758414b6d18876733d-green.png",
      "5": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/5d876188cc3075bf21b22535e5f8f7dc-black.png",
    },
  },
  '505d': {
    name: "Redmi Buds 4 Harry Potter Edition",
    funcs: [1001, 1002, 1004, 3002, 3008, 3010, 4001, 4002, 4003, 5001],
    ncGear: [1, 0, 2],
    tpGear: [0, 1],
    taps: {
      "1": {
        actions: [1, 2, 3],
      },
      "2": {
        actions: [2, 3, 4, 5],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 4,
    images: {
      "4": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/8dfaca97e875bc97beae05ef0abcc675.png",
    },
  },
  '505e': {
    name: "Xiaomi Buds 3 Star Wars",
    funcs: [1001, 1004, 1006, 3002, 3003, 3004, 4003, 4004, 4005],
    ncGear: [1, 0, 2, 4],
    tpGear: [0, 1],
    taps: {
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 2,
    images: {
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/765774863db308b19b896ebb8fbd95c7.png",
    },
  },
  '5066': {
    name: "Xiaomi Buds 3 Disney 100th Anniversary",
    funcs: [1001, 1004, 1006, 3002, 3003, 3004, 4003, 4004, 4005],
    ncGear: [1, 0, 2, 4],
    tpGear: [0, 1],
    taps: {
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 9,
    images: {
      "9": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/66914a9721779195ef46d077f2443b62.png",
    },
  },
  '5069': {
    name: "Redmi Buds 4 Active",
    funcs: [3011],
    defaultColour: 5,
    images: {
      "5": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/6f051f5aa89217bc702d7b391d00cefa.png",
      "6": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/fbb44820c396a541c722ef05e765893f.png",
    },
  },
  '506a': {
    name: "Redmi Buds 5",
    funcs: [1001, 1002, 1005, 2016, 3002, 3003, 3004, 3008, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [1, 0, 2],
    tpGear: [0, 1, 2],
    effects: [0, 6, 5, 1],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [1, 2, 3],
      },
      "2": {
        actions: [2, 3, 4, 5],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/74779914e6f8265aafc5602547105f4e.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/f09230fbc08b8e364058ef47d0ac33d8.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/b8894a70e972288a9220e0a483672f69373.png",
    },
  },
  '506b': {
    name: "Redmi Buds 5 AAPE",
    funcs: [1001, 1002, 1005, 2016, 3002, 3003, 3004, 3008, 3010, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [1, 0, 2],
    tpGear: [0, 1, 2],
    effects: [0, 6, 5, 1],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [1, 2, 3],
      },
      "2": {
        actions: [2, 3, 4, 5],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 4,
    images: {
      "4": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/c0c343a7977df3865cbbd51a0eb3dea5373.png",
    },
  },
  '506c': {
    name: "Redmi Buds 5 Pro",
    funcs: [1001, 1002, 1005, 2002, 2008, 2009, 2016, 3002, 3004, 3008, 3012, 3013, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [1, 0, 2],
    tpGear: [0, 1, 2],
    effects: [0, 6, 5, 1, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [2, 3, 4, 5, 1],
      },
      "2": {
        actions: [2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/645680cd46d75c8000e64c7e8e3db719-white.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/be2430a8e668f7aa35d428e7a66c25a6-black.png",
      "10": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/bd6bd45f0b0ee072fba2fdcc4b2db7ed-blue.png",
    },
  },
  '506f': {
    name: "Redmi Buds 5 Pro Gaming",
    funcs: [1001, 1002, 1005, 2002, 2008, 2009, 2016, 3002, 3004, 3008, 3012, 3013, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [1, 0, 2],
    tpGear: [0, 1, 2],
    effects: [0, 6, 5, 1, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [2, 3, 4, 5, 1],
      },
      "2": {
        actions: [2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 2,
    images: {
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/1f95657e371b37de49ee94152570865f.png",
    },
  },
  '507f': {
    name: "Xiaomi Open-Ear Earbuds",
    funcs: [2016, 2017, 3004, 4001, 4002, 4003, 4006, 5001, 5002, 6001],
    effects: [0, 6, 1],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 6, 9],
        cycle: false,
      },
    },
    defaultColour: 2,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N74A 香槟金.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N74A 灰.png",
    },
  },
  '5081': {
    name: "Xiaomi Buds 5",
    funcs: [1001, 1002, 2002, 2003, 2004, 2005, 2008, 2009, 2016, 3002, 3004, 3006, 3008, 4003, 4004, 4005, 4006, 5001, 5002, 5003, 5005],
    ncGear: [0, 2],
    effects: [0, 1, 6, 13, 11, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [0, 6, 9, 10],
      },
    },
    defaultColour: 2,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N75_0611_国内白.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N75_0611_国内黑.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N75_0611_国内蓝.png",
      "4": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N75_0611_国内金.png",
    },
  },
  '5088': {
    name: "Redmi Buds 6 Active",
    funcs: [2016, 4001, 4002, 4003, 4006, 5001, 5002, 5004],
    effects: [0, 6, 5, 1, 7],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 9],
      },
    },
    defaultColour: 2,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79黑.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79白.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79蓝.png",
    },
  },
  '508a': {
    name: "Redmi Buds 6 Lite",
    funcs: [1002, 1005, 2016, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [0],
    tpGear: [0],
    effects: [0, 6, 5, 1, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 2,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79A黑色.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79A白色.png",
      "5": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79A蓝色.png",
    },
  },
  '508b': {
    name: "Redmi Buds 6 Lite",
    funcs: [1002, 1005, 2016, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [0],
    tpGear: [0],
    effects: [0, 6, 5, 1, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
    },
    defaultColour: 2,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79A黑色.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79A白色.png",
      "5": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79A蓝色.png",
    },
  },
  '5095': {
    name: "Redmi Buds 6S",
    funcs: [1002, 2008, 2016, 3002, 3004, 3008, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [0, 2],
    effects: [0, 6, 5, 1],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 6, 9],
        cycle: false,
      },
    },
    defaultColour: 2,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N77S 白.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N77S 黑.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N77S 蓝.png",
    },
  },
  '509a': {
    name: "REDMI Buds SE",
    funcs: [2016, 3011, 4001, 4002, 4003, 4006, 5001, 5002, 5004],
    effects: [0, 6, 5, 1, 7],
    taps: {
      "4": {
        actions: [8, 1, 4, 5, 2, 3, 9],
      },
      "1": {
        actions: [1, 4, 5, 2, 3, 8],
      },
      "2": {
        actions: [3, 2, 1, 4, 5, 8],
      },
      "3": {
        actions: [0, 9],
        cycle: true,
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79Bcn_主图_白色.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79Bcn_主图_黑色.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79Bcn_主图_粉色.png",
      "4": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79Bcn_主图_蓝色.png",
    },
  },
  '509c': {
    name: "Xiaomi Air4 SE",
    funcs: [2016, 4001, 4002, 4003, 4006, 5001, 5002, 5004],
    effects: [0, 6, 5, 1, 7],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 9],
      },
    },
    defaultColour: 2,
    images: {
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/N79S白色.png",
    },
  },
  '509d': {
    name: "REDMI Buds 6 Pro",
    funcs: [1001, 1002, 1003, 1005, 2002, 2004, 2008, 2009, 2016, 3002, 3003, 3004, 3008, 3012, 4001, 4002, 4003, 4006, 4011, 5001, 5002],
    ncGear: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    tpGear: [0, 1, 2],
    effects: [0, 5, 6, 1, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
      "5": {
        actions: [11, 8],
      },
    },
    defaultColour: 2,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O76cn_白色.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O76cn_黑色.png",
      "4": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O76cn_Turbo.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O76cn_绿色.png",
    },
  },
  '509f': {
    name: "Redmi Buds 6",
    funcs: [1001, 1002, 1005, 2002, 2016, 3002, 3003, 3004, 3008, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [1, 0, 2],
    tpGear: [0, 1, 2],
    effects: [0, 6, 5, 1],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 6, 9],
        cycle: true,
      },
    },
    defaultColour: 2,
    images: {
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O77cn白色.png",
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O77cn黑色.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O77cn青色.png",
    },
  },
  '50ab': {
    name: "Xiaomi Buds 5 Pro Wi-Fi",
    funcs: [1002, 1005, 2002, 2004, 2008, 2009, 2016, 2017, 2018, 3002, 3003, 3004, 3005, 3008, 4003, 4004, 4005, 4006, 4011, 5001, 5002, 5003],
    ncGear: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    tpGear: [0, 1, 2],
    effects: [14, 15, 13, 6, 1, 12, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [6, 0, 9, 10],
        cycle: true,
      },
      "5": {
        actions: [11, 8],
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O71c_首页设备图__黑色.png",
    },
  },
  '50ad': {
    name: "Xiaomi Buds 5 Pro",
    funcs: [1002, 1005, 2002, 2004, 2008, 2009, 2016, 2017, 2018, 3002, 3003, 3004, 3005, 3008, 4003, 4004, 4005, 4006, 4011, 5001, 5002, 5003],
    ncGear: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    tpGear: [0, 1, 2],
    effects: [14, 15, 13, 6, 1, 12, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [6, 0, 9, 10],
        cycle: true,
      },
      "5": {
        actions: [11, 8],
      },
    },
    defaultColour: 2,
    images: {
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O71btc_首页设备图__白色.png",
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O71btc_首页设备图__钛色.png",
    },
  },
  '50af': {
    name: "REDMI Buds 6 Pro Gaming",
    funcs: [1001, 1003, 1005, 2002, 2004, 2008, 2009, 2016, 3002, 3003, 3004, 3008, 3012, 4001, 4002, 4003, 4006, 4011, 5001, 5002, 7001, 7003, 7004, 7005],
    ncGear: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    tpGear: [0, 1, 2],
    effects: [0, 5, 6, 1, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 6],
        cycle: true,
      },
      "5": {
        actions: [11, 8],
      },
    },
    defaultColour: 2,
    images: {
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O76gl_黑色.png",
    },
  },
  '50b5': {
    name: "Xiaomi Bone Conduction Earbuds 2",
    funcs: [2016, 3004, 4012, 4013, 4014, 4015, 4016, 4017, 5001, 5002, 5006, 8001],
    effects: [16, 17, 18],
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O73cn_首页设备图_深锖色.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O73cn_首页设备图_卡其色.png",
    },
  },
  '50b8': {
    name: "Xiaomi Open-Ear Earbuds Pro",
    funcs: [2002, 2004, 2009, 2016, 2019, 3004, 4001, 4002, 4003, 4006, 5001, 5002, 5003],
    effects: [21, 14, 15, 1, 6],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1, 10],
      },
      "3": {
        actions: [0, 8, 10],
        cycle: false,
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O74 APP主页 锖色1-中国.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O74 APP主页 钛色1-中国.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O74 APP主页 金色2-中国.png",
    },
  },
  '50b9': {
    name: "REDMI Buds 7S",
    funcs: [1001, 1002, 2008, 2016, 3002, 3004, 3008, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [0, 2],
    effects: [0, 5, 6, 1, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [],
      },
    },
    defaultColour: 2,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O77Scn_首页设备图_黑色.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O77Scn_首页设备图_白色.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/O77Scn_首页设备图_青色.png",
    },
  },
  '50db': {
    name: "Xiaomi Clip-on Earbuds",
    funcs: [2016, 2021, 3002, 3004, 3008, 3014, 4001, 4002, 5001, 5002, 5003, 5008, 5009],
    effects: [21, 6, 1],
    taps: {
      "1": {
        actions: [8, 2, 3, 4, 5, 1, 10, 0],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1, 10, 0],
      },
    },
    defaultColour: 1,
    images: {},
  },
  '50e1': {
    name: "REDMI Buds 8 Active",
    funcs: [2016, 3004, 4001, 4002, 4003, 4006, 4014, 5001, 5002],
    effects: [21, 5, 1, 6, 7, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [0, 8],
      },
    },
    defaultColour: 2,
    images: {},
  },
  '50e3': {
    name: "REDMI Buds 8 Pro",
    funcs: [1002, 1005, 1008, 1009, 2002, 2004, 2008, 2009, 2016, 2020, 3002, 3003, 3004, 3008, 4001, 4002, 4003, 4006, 4011, 5001, 5002],
    ncGear: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    tpGear: [0, 1, 2],
    effects: [0, 5, 1, 6, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [8, 0, 6],
        cycle: true,
      },
      "5": {
        actions: [11, 8],
      },
    },
    defaultColour: 1,
    images: {
      "1": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/首页设备图国内-白.png",
      "2": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/首页设备图国内-黑.png",
      "3": "https://cdn.cnbj1.fds.api.mi-img.com/static-files/tws_icon/首页设备图国内-蓝.png",
    },
  },
  '50ea': {
    name: "Xiaomi Buds 6",
    funcs: [1001, 1002, 2002, 2004, 2008, 2009, 2016, 3002, 3004, 3006, 3008, 3014, 3015, 4003, 4004, 4005, 4006, 4011, 5001, 5002, 5003, 5008],
    ncGear: [0, 2],
    effects: [21, 14, 15, 13, 1, 6, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [],
      },
      "2": {
        actions: [],
      },
      "3": {
        actions: [8, 0, 6, 10, 9],
        cycle: false,
      },
      "5": {
        actions: [8, 11, 13],
      },
    },
    defaultColour: 1,
    images: {},
  },
  '50ee': {
    name: "REDMI Buds 8 Lite",
    funcs: [1002, 1005, 2016, 3004, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [0],
    tpGear: [0],
    effects: [21, 5, 1, 6, 7, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [8, 0, 6],
        cycle: true,
      },
    },
    defaultColour: 1,
    images: {},
  },
  '50f2': {
    name: "REDMI Buds 8",
    funcs: [1002, 1005, 2008, 2016, 3002, 3003, 3004, 3006, 3008, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [1, 0, 2],
    tpGear: [0, 1, 2],
    effects: [21, 5, 1, 6, 7, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [8, 0, 6, 9],
        cycle: true,
      },
    },
    defaultColour: 1,
    images: {},
  },
  '50fb': {
    name: "REDMI Over-Ear ANC Headphones",
    funcs: [1002, 1005, 2016, 3004, 3006, 4012, 4013, 4014, 4018, 5001, 5002],
    ncGear: [1, 0, 2],
    tpGear: [0],
    effects: [21, 5, 6, 1, 10],
    defaultColour: 1,
    images: {},
  },
  '5113': {
    name: "Xiaomi Air 5",
    funcs: [1002, 1005, 1008, 2002, 2004, 2008, 2009, 2016, 3002, 3003, 3004, 3006, 3007, 3008, 4001, 4002, 4003, 4006, 4011, 5001, 5002],
    ncGear: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    tpGear: [0, 1, 2],
    effects: [21, 5, 6, 1, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [8, 0, 6],
        cycle: true,
      },
      "5": {
        actions: [8, 11],
      },
    },
    defaultColour: 1,
    images: {},
  },
  '511c': {
    name: "REDMI Buds 8S",
    funcs: [1002, 2008, 2016, 3002, 3004, 3006, 3008, 4001, 4002, 4003, 4006, 5001, 5002],
    ncGear: [0, 2],
    effects: [21, 5, 1, 6, 7, 10],
    taps: {
      "4": {
        actions: [8, 2, 3, 4, 5, 1, 9],
      },
      "1": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "2": {
        actions: [8, 2, 3, 4, 5, 1],
      },
      "3": {
        actions: [6, 0, 8, 9],
        cycle: false,
      },
    },
    defaultColour: 1,
    images: {},
  },
};
