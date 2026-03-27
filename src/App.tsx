/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { 
  Shield, 
  Database, 
  Activity, 
  Search, 
  Zap, 
  Layers, 
  CheckCircle2, 
  AlertTriangle, 
  Menu, 
  X, 
  ChevronRight, 
  Cpu, 
  Globe, 
  BarChart3, 
  Terminal,
  RefreshCw,
  Info,
  ExternalLink,
  Lock,
  Eye,
  Microscope,
  LogIn,
  LogOut,
  User as UserIcon,
  Share2,
  Link as LinkIcon,
  Network
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area 
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { analyzeEcoClustering, EcoAnalysisResponse, EcoScore } from './services/aiService';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  addDoc, 
  serverTimestamp 
} from 'firebase/firestore';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, errorInfo: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.errorInfo || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          displayMessage = "Access Denied: You do not have the required permissions for this operation.";
        }
      } catch (e) {
        // Not JSON, use default
      }

      return (
        <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#0f0f0f] border border-red-500/30 rounded-xl p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">System Error</h2>
            <p className="text-sm text-[#888] mb-6">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-500 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-red-600 transition-all"
            >
              Restart System
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Types ---

interface ServerStatus {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  status: 'online' | 'offline' | 'warning';
  function: string;
  load: number;
}

interface CorroborationItem {
  id: string;
  finding: string;
  sources: { name: string; verified: boolean }[];
  status: 'confirmed' | 'pending' | 'disputed';
  confidence: number;
}

interface VDemData {
  year: number;
  score: number;
  baseline: number;
}

// --- Mock Data ---

const INITIAL_SERVERS: ServerStatus[] = [
  { id: 'memory', name: 'Memory Server', tier: 1, status: 'online', function: 'Persistent entity graph', load: 12 },
  { id: 'fetch', name: 'Fetch Server', tier: 1, status: 'online', function: 'Web content fetching', load: 45 },
  { id: 'filesystem', name: 'Filesystem Server', tier: 1, status: 'online', function: 'Local corpus management', load: 8 },
  { id: 'sequential', name: 'Sequential Thinking', tier: 1, status: 'online', function: 'Analytical chains', load: 67 },
  { id: 'playwright', name: 'Playwright Server', tier: 2, status: 'online', function: 'JS rendering (Jmail/ICIJ)', load: 34 },
  { id: 'brave', name: 'Brave Search', tier: 2, status: 'online', function: 'News monitoring', load: 21 },
  { id: 'eco-engine', name: 'Eco Clustering Engine', tier: 3, status: 'online', function: 'Ur-Fascism scoring', load: 89 },
  { id: 'substrate-router', name: 'Substrate Router', tier: 3, status: 'online', function: 'Multi-substrate routing', load: 15 },
  { id: 'vdem-monitor', name: 'V-Dem Monitor', tier: 3, status: 'online', function: 'Democratic drift polling', load: 5 },
];

const MOCK_CORROBORATION: CorroborationItem[] = [
  { 
    id: '1', 
    finding: 'Entity "X" linked to shell company in Panama Papers', 
    sources: [
      { name: 'ICIJ', verified: true },
      { name: 'LittleSis', verified: true },
      { name: 'OpenSanctions', verified: false }
    ],
    status: 'pending',
    confidence: 67
  },
  { 
    id: '2', 
    finding: 'Sudden drift in V-Dem "Freedom of Expression" indicator for Jurisdiction Y', 
    sources: [
      { name: 'V-Dem API', verified: true },
      { name: 'ACLED', verified: true },
      { name: 'Brave News', verified: true }
    ],
    status: 'confirmed',
    confidence: 98
  },
  {
    id: '3',
    finding: 'Historical precedent: Columbus initiated genocide in Hispaniola (1492)',
    sources: [
      { name: 'Zinn Corpus', verified: true },
      { name: 'Las Casas', verified: true },
      { name: 'History of Indies', verified: true }
    ],
    status: 'confirmed',
    confidence: 100
  },
  {
    id: '4',
    finding: 'Proposed Governance: People\'s Assembly to replace federal branches',
    sources: [
      { name: 'Commonwealth Charter', verified: true },
      { name: 'B. Douglas', verified: true }
    ],
    status: 'pending',
    confidence: 85
  },
  {
    id: '5',
    finding: 'Operation Ajax: US/UK orchestrated coup in Iran (1953)',
    sources: [
      { name: 'CIA Archive', verified: true },
      { name: 'National Security Archive', verified: true },
      { name: 'Guardian Substrate', verified: true }
    ],
    status: 'confirmed',
    confidence: 100
  }
];

interface CorpusItem {
  id: string;
  title: string;
  author: string;
  type: string;
  status: 'ingested' | 'processing' | 'queued';
  date: string;
  description?: string;
  resourceLinks?: { category: string; links: { title: string; url: string }[] }[];
}

const MOCK_CORPUS: CorpusItem[] = [
  { id: 'zinn', title: 'A People\'s History of the United States', author: 'Howard Zinn', type: 'Historical Text', status: 'ingested', date: '2026-03-27' },
  { id: 'archetypes', title: 'Communicating Across Ideological Lines', author: 'u/Brief_Head4611', type: 'Communication Guide', status: 'ingested', date: '2026-03-27' },
  { id: 'charter', title: 'The Commonwealth Charter', author: 'B. Douglas', type: 'Governance Blueprint', status: 'ingested', date: '2026-03-27' },
  { id: 'trauma', title: 'Impact of Traumatic Material on Professionals', author: 'Duran & Woodhams', type: 'Qualitative Study', status: 'ingested', date: '2026-03-27' },
  { id: 'iran', title: 'US Involvement In Iran Resource Document', author: 'Declassified Substrate', type: 'Historical Archive', status: 'ingested', date: '2026-03-27' },
  { id: 'cis-prd', title: 'CIS PRD v0.2', author: 'CIS Core Team', type: 'Project Document', status: 'ingested', date: '2026-03-27' },
  { 
    id: 'palestine-israel', 
    title: 'Palestine & Israel: Comprehensive Resource Index', 
    author: 'CIS Intelligence Substrate', 
    type: 'Resource Compilation', 
    status: 'ingested', 
    date: '2026-03-27',
    description: 'A curated collection of historical, genetic, and human rights documentation regarding the region.',
    resourceLinks: [
      {
        category: "Early history of the region",
        links: [
          { title: "The history of Jerusalem", url: "https://www.aljazeera.com/amp/news/2003/12/9/the-history-of-jerusalem" },
          { title: "Judahite temple by Jerusalem may have housed statue of Canaanite god", url: "https://www.haaretz.com/archaeology/2021-10-27/ty-article/judahite-temple-by-jerusalem-may-have-housed-statue-of-canaanite-god/0000017f-e2b7-d38f-a57f-e6f714c90000" },
          { title: "Pagan culture Canaan Israel", url: "https://www.zmescience.com/science/archaeology/pagan-culture-canaan-israel-23082017/" },
          { title: "Genetic study suggests present-day Lebanese descend from biblical Canaanites", url: "https://www.cam.ac.uk/research/news/genetic-study-suggests-present-day-lebanese-descend-from-biblical-canaanites" },
          { title: "DNA from biblical Canaanites lives modern Arabs Jews", url: "https://www.nationalgeographic.com/history/article/dna-from-biblical-canaanites-lives-modern-arabs-jews" },
          { title: "When ancient DNA gets politicized", url: "https://www.smithsonianmag.com/history/when-ancient-dna-gets-politicized-180972639/" },
        ]
      },
      {
        category: "The First Nakba",
        links: [
          { title: "The nakba did not start or end in 1948", url: "https://www.aljazeera.com/amp/features/2017/5/23/the-nakba-did-not-start-or-end-in-1948" },
          { title: "More than a century on the balfour declaration explained", url: "https://www.aljazeera.com/amp/features/2018/11/2/more-than-a-century-on-the-balfour-declaration-explained" },
          { title: "The nakba five palestinian towns massacred 75 years ago", url: "https://www.aljazeera.com/amp/news/2023/5/15/the-nakba-five-palestinian-towns-massacred-75-years-ago" },
          { title: "Israeli soldiers laughing about how they massacred Palestinians", url: "https://www.reddit.com/r/AskMiddleEast/comments/1733xyg/israeli_soldiers_laughing_about_how_they/?share_id=7Um8rEjWa8UiTt95GTcj-&utm_content=1&utm_medium=ios_app&utm_name=ioscss&utm_source=share&utm_term=1" },
        ]
      },
      {
        category: "The Colonization of Palestine",
        links: [
          { title: "Israel occupation 50 years of dispossession", url: "https://amnesty.org/en/latest/campaigns/2017/06/israel-occupation-50-years-of-dispossession/" },
          { title: "IMEU Fact Sheet", url: "https://twitter.com/theimeu/status/1525115272843169792?s=46&t=18eEvk-ancP8FZhQBHlaLA" },
          { title: "The Occupation of Water", url: "https://amnesty.org/en/latest/campaigns/2017/11/the-occupation-of-water/" },
          { title: "Jews to Palestinian whose home they occupy: what do you want?", url: "https://countercurrents.org/2020/05/jews-to-palestinian-whose-home-they-occupy-what-do-you-want/" },
        ]
      },
      {
        category: "Treatment of Palestinians Up to October 7th",
        links: [
          { title: "Israel 50 years occupation abuses", url: "https://www.hrw.org/news/2017/06/04/israel-50-years-occupation-abuses" },
          { title: "Israels apartheid against palestinians", url: "https://www.amnesty.org/en/latest/news/2022/02/israels-apartheid-against-palestinians-a-cruel-system-of-domination-and-a-crime-against-humanity/" },
          { title: "Threshold crossed: Israeli authorities and crimes apartheid and persecution", url: "https://www.hrw.org/report/2021/04/27/threshold-crossed/israeli-authorities-and-crimes-apartheid-and-persecution" },
          { title: "Israel apartheid palestinians occupation", url: "https://apnews.com/article/israel-apartheid-palestinians-occupation-c8137c9e7f33c2cba7b0b5ac7fa8d115" },
          { title: "In Hebron raid female israeli soldiers forced palestinian women to undress", url: "https://haaretz.com/israel-news/2023-09-05/ty-article-magazine/.premium/in-hebron-raid-female-israeli-soldiers-forced-palestinian-women-to-undress/0000018a-6187-d895-ab8b-6fe7b7860000" },
          { title: "Israeli guards rape palestinian women", url: "https://cair.com/cair_in_the_news/israeli-guards-rape-palestinian-women/" },
          { title: "Untold story abuse palestinian women hebron", url: "https://jordantimes.com/opinion/ramzy-baroud/untold-story-abuse-palestinian-women-hebron" },
          { title: "From humiliation to rape: The untold story of israels abuse of palestinian women", url: "https://progressivehub.net/from-humiliation-to-rape-the-untold-story-of-israels-abuse-of-palestinian-women/" },
          { title: "Amnesty Report: Israel and Occupied Palestinian Territories", url: "https://www.amnesty.org/en/location/middle-east-and-north-africa/israel-and-occupied-palestinian-territories/report-israel-and-occupied-palestinian-territories/" },
          { title: "Today they took my son", url: "http://www.oceansofinjustice.com/en/film/372/today-they-took-my-son" },
        ]
      },
      {
        category: "Israeli War Crimes",
        links: [
          { title: "Israeli soldiers torture palestinian detainees", url: "https://www.middleeastmonitor.com/20231101-israeli-soldiers-torture-palestinian-detainees/" },
          { title: "Wadi Siq settler army torture expulsion palestinians", url: "https://www.972mag.com/wadi-siq-settler-army-torture-expulsion-palestinians/" },
          { title: "Deadly pattern: 20 journalists died by israeli military fire in 22 years", url: "https://cpj.org/reports/2023/05/deadly-pattern-20-journalists-died-by-israeli-military-fire-in-22-years-no-one-has-been-held-accountable/" },
          { title: "Damning evidence of war crimes as israeli attacks wipe out entire families in gaza", url: "https://www.amnesty.org/en/latest/news/2023/10/damning-evidence-of-war-crimes-as-israeli-attacks-wipe-out-entire-families-in-gaza/" },
          { title: "Israel using flechette shells in gaza", url: "https://amp.theguardian.com/world/2014/jul/20/israel-using-flechette-shells-in-gaza" },
          { title: "Mass assassination factory: israel calculated bombing gaza", url: "https://www.972mag.com/mass-assassination-factory-israel-calculated-bombing-gaza/" },
        ]
      },
      {
        category: "Children's Deaths",
        links: [
          { title: "Counting the Kids", url: "https://countingthekids.org/" },
        ]
      },
      {
        category: "Genocide of the Palestinian People",
        links: [
          { title: "Public statement scholars warn of potential genocide in gaza", url: "https://opiniojuris.org/2023/10/18/public-statement-scholars-warn-of-potential-genocide-in-gaza/" },
          { title: "Holocaust survivors and their descendants accuse israel of genocide", url: "https://www.independent.co.uk/news/world/middle-east/holocaust-survivors-and-their-descendants-accuse-israel-of-genocide-9687994.html" },
          { title: "Israels unfolding crime genocide palestinian people", url: "https://ccrjustice.org/israel-s-unfolding-crime-genocide-palestinian-people-us-failure-prevent-and-complicity-genocide" },
          { title: "UN experts say ceasefire needed palestinians grave risk genocide", url: "https://www.reuters.com/world/middle-east/un-experts-say-ceasefire-needed-palestinians-grave-risk-genocide-2023-11-02/" },
          { title: "A genocide is under way in palestine", url: "https://www.aljazeera.com/opinions/2023/11/2/a-genocide-is-under-way-in-palestine" },
          { title: "Israeli think tank lays out a blueprint for the complete ethnic cleansing of gaza", url: "https://mondoweiss.net/2023/10/israeli-think-tank-lays-out-a-blueprint-for-the-complete-ethnic-cleansing-of-gaza/" },
        ]
      },
      {
        category: "Gazans Attempt at Peaceful Protest",
        links: [
          { title: "Gaza great march of return", url: "https://www.amnesty.org/en/latest/campaigns/2018/10/gaza-great-march-of-return/" },
          { title: "Gazas great march of return protests explained", url: "https://www.aljazeera.com/news/2019/3/30/gazas-great-march-of-return-protests-explained" },
          { title: "Two years on people injured and traumatized during the great march of return are still struggling", url: "https://www.un.org/unispal/document/two-years-on-people-injured-and-traumatized-during-the-great-march-of-return-are-still-struggling/" },
          { title: "Why gaza protests wont stop", url: "https://www.hrw.org/news/2019/03/29/why-gaza-protests-wont-stop" },
        ]
      },
      {
        category: "Hamas",
        links: [
          { title: "Hamas 2017 document full", url: "https://www.middleeasteye.net/news/hamas-2017-document-full" },
          { title: "Hamas wins huge majority", url: "https://www.aljazeera.com/news/2006/1/26/hamas-wins-huge-majority" },
          { title: "Turkeys erdogan says hamas is not terrorist organisation", url: "https://www.reuters.com/world/middle-east/turkeys-erdogan-says-hamas-is-not-terrorist-organisation-2023-10-25/" },
          { title: "Hamas middle east science", url: "https://apnews.com/article/hamas-middle-east-science-32095d8e1323fc1cad819c34da08fd87" },
        ]
      },
      {
        category: "Israel's Use of Propaganda & Misinformation",
        links: [
          { title: "Fact sheet israels history of spreading disinformation", url: "https://imeu.org/article/fact-sheet-israels-history-of-spreading-disinformation" },
          { title: "Israel response shireen abu akleh killing", url: "https://time.com/6176045/israel-response-shireen-abu-akleh-killing/" },
          { title: "Propaganda wont shed israel its oppressive history", url: "https://www.newarab.com/opinion/propaganda-wont-shed-israel-its-oppressive-history" },
          { title: "Israel is using disinformation and deflection as a foreign policy stratagem", url: "https://truthout.org/articles/israel-is-using-disinformation-and-deflection-as-a-foreign-policy-stratagem/" },
          { title: "Hasbara industry deconstructing israels propaganda machine", url: "https://www.palestinechronicle.com/hasbara-industry-deconstructing-israels-propaganda-machine/" },
          { title: "Billionaires are teaming up for pro-israel anti-hamas media drive report", url: "https://www.aljazeera.com/news/2023/11/12/billionaires-are-teaming-up-for-pro-israel-anti-hamas-media-drive-report" },
          { title: "Israel spying american student activists", url: "https://www.thenation.com/article/world/israel-spying-american-student-activists/" },
          { title: "New York Times Anat Schwartz October 7", url: "https://theintercept.com/2024/02/28/new-york-times-anat-schwartz-october-7/" },
        ]
      },
      {
        category: "Anti-Zionist Jewish Voices",
        links: [
          { title: "We cant let antisemitism be weaponized to criminalize solidarity with palestine", url: "https://truthout.org/articles/we-cant-let-antisemitism-be-weaponized-to-criminalize-solidarity-with-palestine/" },
          { title: "An open letter from jewish students", url: "https://www.browndailyherald.com/article/2023/11/an-open-letter-from-jewish-students" },
          { title: "Questioning israels party line a jewish activist explains her awakening", url: "https://www.trtworld.com/magazine/questioning-israels-party-line-a-jewish-activist-explains-her-awakening-15814522" },
          { title: "Is zionism a liberating democratic movement", url: "https://foroys.wordpress.com/2017/06/20/is-zionism-a-liberating-democratic-movement-part-13/" },
        ]
      },
      {
        category: "Israel vs. Israeli Citizens and Jewish People",
        links: [
          { title: "The secret suffering of israels holocaust survivors", url: "https://www.washingtonpost.com/archive/lifestyle/1993/04/23/the-secret-suffering-of-israels-holocaust-survivors/82c1a7ba-3233-4351-b4b8-f7387e291335/" },
          { title: "One third of israeli holocaust survivors live in poverty advocates say", url: "https://www.pbs.org/newshour/world/one-third-of-israeli-holocaust-survivors-live-in-poverty-advocates-say" },
          { title: "Israel abuses holocaust survivors", url: "https://www.tabletmag.com/sections/israel-middle-east/articles/israel-abuses-holocaust-survivors" },
          { title: "Israel police boss threatens to send anti-war protesters to gaza on buses", url: "https://www.aljazeera.com/amp/news/2023/10/19/israel-police-boss-threatens-to-send-anti-war-protesters-to-gaza-on-buses" },
          { title: "Report 7 october testimonies strikes major blow to israeli narrative", url: "https://www.middleeastmonitor.com/20231030-report-7-october-testimonies-strikes-major-blow-to-israeli-narrative/" },
          { title: "Israels military shelled burning tanks helicopters", url: "https://thegrayzone.com/2023/10/27/israels-military-shelled-burning-tanks-helicopters/" },
          { title: "Netanyahu rejected ceasefire for hostages deal in gaza sources say", url: "https://www.theguardian.com/world/2023/nov/09/netanyahu-rejected-ceasefire-for-hostages-deal-in-gaza-sources-say" },
          { title: "Evidence israel killed its own citizens 7 october", url: "https://electronicintifada.net/content/evidence-israel-killed-its-own-citizens-7-october/41156" },
          { title: "Ethiopian women given contraceptives israel", url: "https://amp.theguardian.com/world/2013/feb/28/ethiopian-women-given-contraceptives-israel" },
        ]
      },
      {
        category: "Peace Negotiations",
        links: [
          { title: "Myth palestinians sabotaged the peace process", url: "https://decolonizepalestine.com/myth/palestinians-sabotaged-the-peace-process/" },
          { title: "Israel rejected peace with hamas on five occasions", url: "https://inkstickmedia.com/israel-rejected-peace-with-hamas-on-five-occasions/" },
        ]
      },
      {
        category: "The Role of Egypt",
        links: [
          { title: "Israel egypt gaza", url: "https://www.nytimes.com/2023/11/05/world/middleeast/israel-egypt-gaza.html" },
          { title: "Rafah crossing gaza egypt explainer", url: "https://www.cnn.com/2023/11/01/middleeast/rafah-crossing-gaza-egypt-explainer-intl/index.html" },
          { title: "Palestinians gaza fear permanent expulsion", url: "https://time.com/6330904/palestinians-gaza-fear-permanent-expulsion/" },
          { title: "Gaza evacuations suspended since saturday after ambulance targeted egypt sources", url: "https://www.reuters.com/world/middle-east/gaza-evacuations-suspended-since-saturday-after-ambulance-targeted-egypt-sources-2023-11-05/" },
        ]
      },
      {
        category: "The Role of the United States",
        links: [
          { title: "Joe Biden Israel USA invent Israel protect interest region", url: "https://www.c-span.org/video/?c4962369/user-clip-joe-biden-israel-usa-invent-israel-protect-interest-region" },
          { title: "US israel support ally gaza war aid", url: "https://www.vox.com/world-politics/23916266/us-israel-support-ally-gaza-war-aid" },
          { title: "US israel romance united state support aid military middle east", url: "https://jacobin.com/2021/05/us-israel-romance-united-state-support-aid-military-middle-east" },
          { title: "How much military aid does the us give to israel", url: "https://usafacts.org/articles/how-much-military-aid-does-the-us-give-to-israel/" },
          { title: "US house passes 14.5bn military aid package for israel", url: "https://www.aljazeera.com/news/2023/11/3/us-house-passes-14-5bn-military-aid-package-for-israel" },
        ]
      }
    ]
  },
];

const VDEM_HISTORY: VDemData[] = [
  { year: 2018, score: 0.82, baseline: 0.80 },
  { year: 2019, score: 0.81, baseline: 0.80 },
  { year: 2020, score: 0.78, baseline: 0.80 },
  { year: 2021, score: 0.75, baseline: 0.80 },
  { year: 2022, score: 0.72, baseline: 0.80 },
  { year: 2023, score: 0.68, baseline: 0.80 },
  { year: 2024, score: 0.65, baseline: 0.80 },
  { year: 2025, score: 0.62, baseline: 0.80 },
];

// --- Components ---

const Sidebar = ({ servers, activeTab, setActiveTab }: { servers: ServerStatus[], activeTab: string, setActiveTab: (t: string) => void }) => {
  return (
    <div className="w-72 bg-[#0a0a0a] border-r border-[#222] flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-[#222]">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-8 h-8 text-[#00ff00]" />
          <h1 className="text-xl font-bold tracking-tighter text-white uppercase">CIS Mission Control</h1>
        </div>
        <p className="text-[10px] text-[#666] uppercase tracking-widest font-mono">Civilizational Immune System v0.3</p>
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        <div className="px-4 mb-6">
          <p className="text-[10px] text-[#444] uppercase tracking-widest font-bold mb-4 px-2">Core Modules</p>
          {[
            { id: 'eco', name: 'Eco Clustering', icon: Microscope },
            { id: 'corpus', name: 'Knowledge Corpus', icon: Database },
            { id: 'prd', name: 'CIS PRD v0.3', icon: Shield },
            { id: 'deterrence', name: 'Deterrence Sim', icon: Zap },
            { id: 'osint', name: 'OSINT Network', icon: Network },
            { id: 'router', name: 'Substrate Router', icon: Layers },
            { id: 'corroboration', name: 'Corroboration', icon: CheckCircle2 },
            { id: 'vdem', name: 'V-Dem Monitor', icon: Globe },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium mb-1",
                activeTab === item.id 
                  ? "bg-[#1a1a1a] text-[#00ff00] border border-[#333]" 
                  : "text-[#888] hover:text-white hover:bg-[#111]"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.name}
            </button>
          ))}
        </div>

        <div className="px-4">
          <p className="text-[10px] text-[#444] uppercase tracking-widest font-bold mb-4 px-2">MCP Ecosystem Status</p>
          <div className="space-y-2">
            {servers.map((server) => (
              <div key={server.id} className="p-3 bg-[#0f0f0f] rounded-lg border border-[#1a1a1a] group hover:border-[#333] transition-all">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-mono text-[#aaa]">{server.name}</span>
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    server.status === 'online' ? "bg-[#00ff00] shadow-[0_0_8px_#00ff00]" : "bg-red-500"
                  )} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-[#555] uppercase tracking-tighter">Tier {server.tier}</span>
                  <div className="w-16 h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#333] transition-all duration-1000" 
                      style={{ width: `${server.load}%` }} 
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </nav>

      <div className="p-6 border-t border-[#222] bg-[#050505]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center">
            <Zap className="w-5 h-5 text-[#00ff00]" />
          </div>
          <div>
            <p className="text-xs font-bold text-white">System Load</p>
            <p className="text-[10px] text-[#666]">42% Capacity</p>
          </div>
        </div>
        <button className="w-full py-2 bg-[#00ff00] text-black text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#00cc00] transition-all">
          Emergency Lockdown
        </button>
      </div>
    </div>
  );
};

const EcoClusteringTab = () => {
  const [text, setText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<EcoAnalysisResponse | null>(null);
  const [selectedBackend, setSelectedBackend] = useState<"Gemini" | "Anthropic">("Gemini");

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeEcoClustering(text, selectedBackend);
      setAnalysis(result);
    } catch (error) {
      console.error("Analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Eco Clustering Engine</h2>
            <p className="text-sm text-[#888]">Analyze narratives against Umberto Eco's 14 points of Ur-Fascism. Focus on behavior clustering, not labeling.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-[#1a1a1a] border border-[#333] rounded-lg p-1">
              <button 
                onClick={() => setSelectedBackend("Gemini")}
                className={cn(
                  "px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition-all",
                  selectedBackend === "Gemini" ? "bg-[#00ff00] text-black" : "text-[#666] hover:text-white"
                )}
              >
                Gemini
              </button>
              <button 
                onClick={() => setSelectedBackend("Anthropic")}
                className={cn(
                  "px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition-all",
                  selectedBackend === "Anthropic" ? "bg-[#00ff00] text-black" : "text-[#666] hover:text-white"
                )}
              >
                Anthropic
              </button>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 bg-[#1a1a1a] border border-[#333] rounded-full">
              <Cpu className="w-3 h-3 text-[#00ff00]" />
              <span className="text-[10px] font-mono text-[#aaa]">
                {selectedBackend === "Gemini" ? "Powered by Gemini 3.1 Flash" : "Powered by Claude 3.5 Sonnet"}
              </span>
            </div>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste narrative, news article, or transcript for analysis..."
          className="w-full h-48 bg-[#050505] border border-[#222] rounded-lg p-4 text-sm text-[#ccc] focus:outline-none focus:border-[#00ff00] transition-all font-mono"
        />

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !text.trim()}
            className={cn(
              "px-8 py-3 rounded-lg font-bold text-sm uppercase tracking-widest transition-all flex items-center gap-2",
              isAnalyzing || !text.trim() 
                ? "bg-[#1a1a1a] text-[#444] cursor-not-allowed" 
                : "bg-[#00ff00] text-black hover:bg-[#00cc00] shadow-[0_0_20px_rgba(0,255,0,0.2)]"
            )}
          >
            {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {isAnalyzing ? "Processing Analytical Chain..." : "Run Eco Analysis"}
          </button>
        </div>
      </section>

      <AnimatePresence>
        {analysis && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-[#0f0f0f] border border-[#222] p-6 rounded-xl flex flex-col items-center justify-center text-center">
                <p className="text-[10px] text-[#666] uppercase tracking-widest mb-2">Diagnostic Threshold</p>
                <div className={cn(
                  "text-4xl font-black uppercase tracking-tighter mb-1",
                  analysis.overallThreshold === 'Red' ? "text-red-500" : 
                  analysis.overallThreshold === 'Orange' ? "text-orange-500" : 
                  analysis.overallThreshold === 'Yellow' ? "text-yellow-500" : "text-[#222]"
                )}>
                  {analysis.overallThreshold}
                </div>
                <div className="text-[10px] font-mono text-[#666]">
                  Score: <span className="text-[#00ff00]">{analysis.totalWeightedScore.toFixed(1)}</span>
                </div>
              </div>
              <div className="bg-[#0f0f0f] border border-[#222] p-6 rounded-xl flex flex-col items-center justify-center text-center">
                <p className="text-[10px] text-[#666] uppercase tracking-widest mb-2">Confidence Rating</p>
                <div className="text-4xl font-black text-white tracking-tighter">
                  {analysis.confidence}%
                </div>
              </div>
              <div className="bg-[#0f0f0f] border border-[#222] p-6 rounded-xl flex flex-col items-center justify-center text-center">
                <p className="text-[10px] text-[#666] uppercase tracking-widest mb-2">Points Detected</p>
                <div className="text-4xl font-black text-[#00ff00] tracking-tighter">
                  {analysis.scores.filter(s => s.isIdentified).length} / 14
                </div>
              </div>
            </div>

            <div className="bg-[#0f0f0f] border border-[#222] rounded-xl overflow-hidden">
              <div className="p-6 border-b border-[#222] bg-[#151515]">
                <h3 className="text-lg font-bold text-white">Detailed Point Analysis</h3>
              </div>
              <div className="divide-y divide-[#222]">
                {analysis.scores.map((point) => (
                  <div key={point.point} className={cn(
                    "p-6 transition-all group",
                    point.isIdentified ? "bg-[#111]" : "bg-transparent opacity-50 grayscale"
                  )}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <span className={cn(
                          "text-2xl font-black transition-all",
                          point.isIdentified ? "text-[#00ff00]" : "text-[#222]"
                        )}>
                          {point.point.toString().padStart(2, '0')}
                        </span>
                        <div>
                          <h4 className="text-sm font-bold text-white">{point.title}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={cn(
                              "text-[10px] font-mono uppercase px-2 py-0.5 rounded",
                              point.isIdentified ? "bg-[#00ff00]/10 text-[#00ff00]" : "bg-[#222] text-[#444]"
                            )}>
                              {point.isIdentified ? "Identified" : "Not Detected"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] font-mono text-[#444] uppercase">Weight: {point.point === 14 ? "1.5x" : "1.0x"}</div>
                    </div>
                    {point.isIdentified && (
                      <p className="text-xs text-[#888] leading-relaxed italic border-l-2 border-[#00ff00]/30 pl-4">
                        "{point.evidence}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#0f0f0f] border border-[#222] p-8 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Analytical Summary</h3>
              <div className="prose prose-invert prose-sm max-w-none text-[#aaa]">
                <ReactMarkdown>{analysis.summary}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const CorpusTab = ({ items }: { items: CorpusItem[] }) => {
  const [selectedItem, setSelectedItem] = useState<CorpusItem | null>(null);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Knowledge Corpus Management</h2>
            <p className="text-sm text-[#888]">Primary intelligence substrates and historical texts ingested into the CIS Memory Server.</p>
          </div>
          <button className="px-4 py-2 bg-[#111] border border-[#222] text-[#00ff00] text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#1a1a1a] transition-all flex items-center gap-2">
            <RefreshCw className="w-3 h-3" />
            Sync Memory Server
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {items.map((item) => (
            <div key={item.id} className="bg-[#050505] border border-[#1a1a1a] rounded-xl p-6 hover:border-[#333] transition-all group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="w-12 h-12 rounded-lg bg-[#111] border border-[#222] flex items-center justify-center">
                    <Database className="w-6 h-6 text-[#444] group-hover:text-[#00ff00] transition-all" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{item.title}</h4>
                    <p className="text-[10px] text-[#666] uppercase tracking-widest mt-1">Author: {item.author} • {item.type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-8">
                  <div className="text-right">
                    <p className="text-[9px] text-[#555] uppercase">Ingested On</p>
                    <p className="text-xs font-mono text-[#aaa]">{item.date}</p>
                  </div>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                    item.status === 'ingested' ? "bg-[#00ff00]/10 text-[#00ff00] border border-[#00ff00]/20" : "bg-orange-500/10 text-orange-500 border border-orange-500/20"
                  )}>
                    {item.status}
                  </span>
                  <button 
                    onClick={() => setSelectedItem(item)}
                    className="p-2 rounded-lg bg-[#111] border border-[#222] text-[#666] hover:text-[#00ff00] hover:border-[#00ff00] transition-all"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <AnimatePresence>
        {selectedItem && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#0f0f0f] border border-[#222] rounded-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-[#222] flex items-center justify-between bg-[#151515]">
                <div>
                  <h3 className="text-xl font-bold text-white">{selectedItem.title}</h3>
                  <p className="text-[10px] text-[#666] uppercase tracking-widest mt-1">Substrate Detail View</p>
                </div>
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="p-2 rounded-lg bg-[#222] text-[#888] hover:text-white transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {selectedItem.description && (
                  <div>
                    <h4 className="text-[10px] text-[#444] uppercase tracking-widest font-bold mb-3">Abstract</h4>
                    <p className="text-sm text-[#aaa] leading-relaxed">{selectedItem.description}</p>
                  </div>
                )}

                {selectedItem.resourceLinks && (
                  <div className="space-y-6">
                    <h4 className="text-[10px] text-[#444] uppercase tracking-widest font-bold mb-3">Linked Intelligence Substrates</h4>
                    {selectedItem.resourceLinks.map((cat, i) => (
                      <div key={i} className="space-y-3">
                        <h5 className="text-xs font-bold text-[#00ff00] border-b border-[#222] pb-2">{cat.category}</h5>
                        <div className="grid grid-cols-1 gap-2">
                          {cat.links.map((link, j) => (
                            <a 
                              key={j}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between p-3 bg-[#050505] border border-[#1a1a1a] rounded-lg hover:border-[#00ff00]/30 transition-all group"
                            >
                              <span className="text-xs text-[#888] group-hover:text-white transition-all">{link.title}</span>
                              <ExternalLink className="w-3 h-3 text-[#444] group-hover:text-[#00ff00]" />
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!selectedItem.resourceLinks && !selectedItem.description && (
                  <div className="py-12 text-center">
                    <Database className="w-12 h-12 text-[#222] mx-auto mb-4" />
                    <p className="text-sm text-[#444]">Detailed substrate analysis pending ingestion.</p>
                  </div>
                )}
              </div>
              
              <div className="p-6 border-t border-[#222] bg-[#151515] flex justify-end">
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="px-6 py-2 bg-[#222] text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#333] transition-all"
                >
                  Close Substrate
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <h3 className="text-lg font-bold text-white mb-6">Memory Server Analytics</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 bg-[#050505] border border-[#1a1a1a] rounded-xl">
            <p className="text-[10px] text-[#666] uppercase tracking-widest mb-2">Total Entities</p>
            <p className="text-3xl font-black text-white">14,282</p>
          </div>
          <div className="p-6 bg-[#050505] border border-[#1a1a1a] rounded-xl">
            <p className="text-[10px] text-[#666] uppercase tracking-widest mb-2">Relationship Edges</p>
            <p className="text-3xl font-black text-white">89,401</p>
          </div>
          <div className="p-6 bg-[#050505] border border-[#1a1a1a] rounded-xl">
            <p className="text-[10px] text-[#666] uppercase tracking-widest mb-2">Corroboration Rate</p>
            <p className="text-3xl font-black text-[#00ff00]">92.4%</p>
          </div>
        </div>
      </section>
    </div>
  );
};

const OsintNetworkTab = () => {
  const colabUrl = "https://colab.research.google.com/drive/1wi0vxGOprXDsrqSL2qTjygj-q8yJzybg?usp=sharing";
  
  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">OSINT Network Node</h2>
            <p className="text-sm text-[#888]">Decentralized intelligence gathering and analysis network.</p>
          </div>
          <a 
            href={colabUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="px-4 py-2 bg-[#00ff00] text-black text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#00cc00] transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(0,255,0,0.3)]"
          >
            <ExternalLink className="w-3 h-3" />
            Launch Colab Environment
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-[#050505] border border-[#1a1a1a] rounded-xl p-6">
            <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-widest flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#00ff00]" />
              Network Configuration
            </h3>
            <div className="space-y-4 font-mono text-xs">
              <div className="flex justify-between border-b border-[#111] pb-2">
                <span className="text-[#666]">Node ID:</span>
                <span className="text-[#aaa]">OSINT-CIS-01</span>
              </div>
              <div className="flex justify-between border-b border-[#111] pb-2">
                <span className="text-[#666]">Environment:</span>
                <span className="text-[#aaa]">Google Colab / Python 3.10</span>
              </div>
              <div className="flex justify-between border-b border-[#111] pb-2">
                <span className="text-[#666]">Substrates:</span>
                <span className="text-[#aaa]">Twitter, ICIJ, OpenSanctions</span>
              </div>
              <div className="flex justify-between border-b border-[#111] pb-2">
                <span className="text-[#666]">Encryption:</span>
                <span className="text-[#aaa]">AES-256-GCM (End-to-End)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666]">Status:</span>
                <span className="text-[#00ff00] animate-pulse">ACTIVE / LISTENING</span>
              </div>
            </div>
          </div>

          <div className="bg-[#050505] border border-[#1a1a1a] rounded-xl p-6">
            <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-widest flex items-center gap-2">
              <Share2 className="w-4 h-4 text-[#00ff00]" />
              Network Impact
            </h3>
            <p className="text-xs text-[#888] leading-relaxed mb-4">
              This node is part of a global OSINT network designed to track and expose systemic corruption. By leveraging decentralized analysis, we ensure that no single entity can suppress the findings.
            </p>
            <div className="flex items-center gap-4">
              <div className="flex-1 h-1 bg-[#111] rounded-full overflow-hidden">
                <div className="h-full bg-[#00ff00] w-[78%]" />
              </div>
              <span className="text-[10px] font-mono text-[#00ff00]">78% Coverage</span>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <h3 className="text-lg font-bold text-white mb-6">Live Network Feed</h3>
        <div className="space-y-4">
          {[
            { time: "14:02:11", event: "Node connected to ICIJ substrate", status: "success" },
            { time: "14:03:45", event: "Analyzing shell company clusters in Jurisdiction Alpha", status: "processing" },
            { time: "14:05:02", event: "New relationship edge detected: Entity X -> Entity Y", status: "alert" },
            { time: "14:06:00", event: "Syncing findings with CIS Memory Server", status: "success" },
          ].map((log, i) => (
            <div key={i} className="flex items-center gap-4 p-3 bg-[#050505] border border-[#1a1a1a] rounded-lg font-mono text-[10px]">
              <span className="text-[#444]">{log.time}</span>
              <span className={cn(
                "flex-1",
                log.status === 'alert' ? "text-red-500" : log.status === 'processing' ? "text-orange-500" : "text-[#00ff00]"
              )}>
                {log.event}
              </span>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                log.status === 'alert' ? "bg-red-500 shadow-[0_0_5px_#ef4444]" : log.status === 'processing' ? "bg-orange-500" : "bg-[#00ff00]"
              )} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

const SubstrateRouterTab = () => {
  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
            <h2 className="text-2xl font-bold text-white mb-6">Substrate Routing Map</h2>
            <div className="relative h-96 bg-[#050505] rounded-lg border border-[#1a1a1a] overflow-hidden flex items-center justify-center">
              <div className="absolute inset-0 opacity-10">
                <div className="w-full h-full" style={{ backgroundImage: 'radial-gradient(#00ff00 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
              </div>
              
              {/* Visual representation of nodes */}
              <div className="relative z-10 flex flex-col items-center gap-12">
                <div className="w-20 h-20 rounded-full bg-[#00ff00]/10 border border-[#00ff00] flex items-center justify-center animate-pulse">
                  <Shield className="w-8 h-8 text-[#00ff00]" />
                </div>
                
                <div className="grid grid-cols-3 gap-12">
                  {[
                    { name: 'Epstein Layer', icon: Lock },
                    { name: 'Panama Papers', icon: Database },
                    { name: 'FinCEN Files', icon: Activity },
                    { name: 'Lobbying Data', icon: BarChart3 },
                    { name: 'V-Dem API', icon: Globe },
                    { name: 'ACLED', icon: AlertTriangle },
                  ].map((node, i) => (
                    <div key={i} className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-lg bg-[#111] border border-[#222] flex items-center justify-center group hover:border-[#00ff00] transition-all cursor-pointer">
                        <node.icon className="w-5 h-5 text-[#666] group-hover:text-[#00ff00]" />
                      </div>
                      <span className="text-[10px] font-mono text-[#555] uppercase">{node.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Connecting lines (simulated) */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
                <line x1="50%" y1="30%" x2="20%" y2="60%" stroke="#00ff00" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="50%" y1="30%" x2="50%" y2="60%" stroke="#00ff00" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="50%" y1="30%" x2="80%" y2="60%" stroke="#00ff00" strokeWidth="1" strokeDasharray="4 4" />
              </svg>
            </div>
          </section>

          <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
            <h3 className="text-lg font-bold text-white mb-4">Active Routing Gaps</h3>
            <div className="space-y-4">
              {[
                { name: 'Jmail JavaScript Rendering', status: 'Blocked', reason: 'Requires Playwright MCP', severity: 'High' },
                { name: 'ICIJ Offshore Leaks', status: 'Partial', reason: 'Rate limited by substrate', severity: 'Medium' },
                { name: 'OpenAlex Academic Feed', status: 'Syncing', reason: 'Large corpus ingestion', severity: 'Low' },
              ].map((gap, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-[#050505] border border-[#1a1a1a] rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      gap.severity === 'High' ? "bg-red-500" : gap.severity === 'Medium' ? "bg-orange-500" : "bg-blue-500"
                    )} />
                    <div>
                      <p className="text-sm font-bold text-white">{gap.name}</p>
                      <p className="text-[10px] text-[#666]">{gap.reason}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-[#444] uppercase">{gap.status}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-6">
            <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-widest">Router Config</h3>
            <div className="space-y-4">
              <div className="p-4 bg-[#050505] border border-[#1a1a1a] rounded-lg">
                <p className="text-[10px] text-[#666] uppercase mb-2">Strategy</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white">Breadth-First Corroboration</span>
                  <RefreshCw className="w-3 h-3 text-[#00ff00]" />
                </div>
              </div>
              <div className="p-4 bg-[#050505] border border-[#1a1a1a] rounded-lg">
                <p className="text-[10px] text-[#666] uppercase mb-2">Confidence Threshold</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white">0.85 (High Rigor)</span>
                  <Zap className="w-3 h-3 text-[#00ff00]" />
                </div>
              </div>
              <div className="p-4 bg-[#050505] border border-[#1a1a1a] rounded-lg">
                <p className="text-[10px] text-[#666] uppercase mb-2">Substrate Depth</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white">Level 4 (Full Graph)</span>
                  <Layers className="w-3 h-3 text-[#00ff00]" />
                </div>
              </div>
            </div>
          </section>

          <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-6">
            <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-widest">Live Logs</h3>
            <div className="h-64 bg-[#050505] border border-[#1a1a1a] rounded-lg p-4 font-mono text-[10px] text-[#00ff00] overflow-y-auto space-y-1">
              <p>[13:36:44] ROUTER: Initializing substrate chain...</p>
              <p>[13:36:45] FETCH: Querying OpenSanctions for entity "X"</p>
              <p>[13:36:47] MEMORY: Entity relationship found (0.92 confidence)</p>
              <p>[13:36:48] ECO: Scoring narrative chunk 4/12</p>
              <p className="text-[#666]">[13:36:50] WARN: Jmail rendering blocked (Playwright offline)</p>
              <p>[13:36:52] ROUTER: Rerouting to secondary substrate (ICIJ)</p>
              <p className="animate-pulse">_</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

const DeterrenceTab = () => {
  const [gameState, setGameState] = useState<'idle' | 'active' | 'destroyed'>('idle');
  const [history, setHistory] = useState<{ action: string; result: string; payoff: number }[]>([]);
  const [totalPayoff, setTotalPayoff] = useState(0);

  const handleAction = (action: 'observe' | 'capture') => {
    if (gameState === 'destroyed') return;

    let result = '';
    let payoff = 0;

    if (action === 'observe') {
      result = "CIS remains independent. Diagnostic data received.";
      payoff = 10;
      setGameState('active');
    } else {
      result = "CAPTURE ATTEMPT DETECTED. SELF-DESTRUCT TRIGGERED.";
      payoff = -50;
      setGameState('destroyed');
    }

    setHistory([{ action, result, payoff }, ...history]);
    setTotalPayoff(prev => prev + payoff);
  };

  const resetSim = () => {
    setGameState('idle');
    setHistory([]);
    setTotalPayoff(0);
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Deterrence Logic Simulator</h2>
            <p className="text-sm text-[#888]">Testing the "Honeypot" game theory of the CIS.</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-[#666] uppercase tracking-widest font-mono mb-1">Cumulative Payoff</p>
            <p className={`text-2xl font-mono font-bold ${totalPayoff >= 0 ? 'text-[#00ff00]' : 'text-red-500'}`}>
              {totalPayoff > 0 ? '+' : ''}{totalPayoff}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className={`p-6 rounded-xl border transition-all ${
            gameState === 'destroyed' ? 'bg-red-500/5 border-red-500/20' : 'bg-[#111] border-[#222]'
          }`}>
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Zap className={`w-5 h-5 ${gameState === 'destroyed' ? 'text-red-500' : 'text-[#00ff00]'}`} />
              System Status: {gameState.toUpperCase()}
            </h3>
            <p className="text-sm text-[#888] leading-relaxed mb-6">
              {gameState === 'idle' && "The CIS is currently monitoring global signals. No state actor has attempted capture."}
              {gameState === 'active' && "The system is providing high-value diagnostic data to all civil society monitors."}
              {gameState === 'destroyed' && "CRITICAL FAILURE. The system has permanently erased all data and infrastructure to prevent capture."}
            </p>
            
            <div className="flex gap-4">
              <button 
                onClick={() => handleAction('observe')}
                disabled={gameState === 'destroyed'}
                className="flex-1 px-4 py-3 bg-[#111] border border-[#222] text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#1a1a1a] disabled:opacity-50 transition-all"
              >
                Observe & Cooperate
              </button>
              <button 
                onClick={() => handleAction('capture')}
                disabled={gameState === 'destroyed'}
                className="flex-1 px-4 py-3 bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] font-bold uppercase tracking-widest rounded hover:bg-red-500/20 disabled:opacity-50 transition-all"
              >
                Attempt Capture
              </button>
            </div>
          </div>

          <div className="bg-[#111] border border-[#222] rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">Payoff Matrix</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-[#0a0a0a] rounded border border-[#222]">
                <span className="text-xs text-[#888]">Observe (Cooperate)</span>
                <span className="text-xs font-mono text-[#00ff00]">+10 Utility</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-[#0a0a0a] rounded border border-[#222]">
                <span className="text-xs text-[#888]">Capture (Defect)</span>
                <span className="text-xs font-mono text-red-500">-50 Utility (System Gone)</span>
              </div>
              <p className="text-[10px] text-[#555] italic">
                *Utility represents the value of diagnostic intelligence vs the cost of total system loss.
              </p>
            </div>
          </div>
        </div>

        {gameState === 'destroyed' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-6 bg-red-500/10 border border-red-500/30 rounded-xl text-center"
          >
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h4 className="text-xl font-bold text-white mb-2 uppercase tracking-tighter">Self-Destruct Executed</h4>
            <p className="text-sm text-[#888] mb-6">
              The system detected a capture attempt and triggered the automated fail-safe. 
              All keys in the Shamir's Secret Sharing model have been invalidated.
            </p>
            <button 
              onClick={resetSim}
              className="px-6 py-2 bg-white text-black text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#ccc] transition-all"
            >
              Re-Initialize System
            </button>
          </motion.div>
        )}

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white">Action Log</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
            {history.map((entry, i) => (
              <div key={i} className="p-4 bg-[#111] border border-[#222] rounded flex justify-between items-center">
                <div>
                  <p className="text-[10px] font-bold text-[#00ff00] uppercase tracking-widest mb-1">
                    Action: {entry.action}
                  </p>
                  <p className="text-xs text-[#888]">{entry.result}</p>
                </div>
                <span className={`font-mono text-sm ${entry.payoff >= 0 ? 'text-[#00ff00]' : 'text-red-500'}`}>
                  {entry.payoff > 0 ? '+' : ''}{entry.payoff}
                </span>
              </div>
            ))}
            {history.length === 0 && (
              <p className="text-sm text-[#555] italic text-center py-8">No actions recorded. Initiate simulation.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#0f0f0f] border border-[#222] rounded-xl p-6">
          <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-4">The Deterrence Logic</h4>
          <p className="text-xs text-[#888] leading-relaxed">
            The CIS is a "Civilizational Honeypot." It invites capture attempts but punishes them with total destruction, ensuring that the only way to benefit from the system is to allow it to remain independent.
          </p>
        </div>
        <div className="bg-[#0f0f0f] border border-[#222] rounded-xl p-6">
          <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-4">Credible Commitment</h4>
          <p className="text-xs text-[#888] leading-relaxed">
            By automating the self-destruct mechanism (Section 5.1), the CIS removes the human element that could be coerced. The threat of destruction is 100% credible.
          </p>
        </div>
        <div className="bg-[#0f0f0f] border border-[#222] rounded-xl p-6">
          <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-4">Nash Equilibrium</h4>
          <p className="text-xs text-[#888] leading-relaxed">
            In this game, the only stable state is mutual cooperation (Observe). Any attempt to defect (Capture) results in a zero-sum loss for all players.
          </p>
        </div>
      </section>
    </div>
  );
};

const PrdTab = () => {
  const sections = [
    { id: 1, title: "Core Design Principles", content: "Constitutional layer: Diagnostic Only, Loyalty-Neutral, Self-Destruct Fail-Safe." },
    { id: 2, title: "System Origin & Methodology", content: "Pizza Index and behavioral signals as indirect indicators of operational tempo." },
    { id: 3, title: "Threat Definition: Eco 14", content: "Umberto Eco's 14 features of Ur-Fascism as the core diagnostic antigen." },
    { id: 4, title: "Detection Thresholds", content: "Graded warnings: YELLOW (3.0+), ORANGE (6.0+), RED (9.0+) weighted points." },
    { id: 5, title: "Fail-Safe Architecture", content: "Automated self-destruct mechanism and Shamir's Secret Sharing model." },
    { id: 6, title: "Data Sources", content: "V-Dem, Freedom House, ACLED, CPJ, RSF, and the Epstein Files layer." },
    { id: 7, title: "Unresolved Items", content: "People's Assembly, Capital Tension, and AI backend loyalty-neutrality." },
    { id: 8, title: "Technical Stack", content: "MCP Server Topology, Gemini (swappable), and Rules-based scoring." },
    { id: 9, title: "Philosophical Foundation", content: "Civilizational immune response, cybernetics, and Ostrom's commons." },
    { id: 10, title: "Intended Users", content: "Civil Society Monitors, Verified Researchers, Public Broadcast (RED only)." },
    { id: 11, title: "Output Mechanism", content: "Encrypted reports, tamper-evident ledger, and Silence-as-a-Signal." },
    { id: 12, title: "Eco Update Mechanism", content: "Locked core (1995 text) vs updateable indicator layer." },
    { id: 13, title: "Minimum Viable Version", content: "Phase 1: Hungary Backtest (2008–present). Phase 2: Live Monitoring." },
    { id: 14, title: "Spectrum Overlap Calibration", content: "Distinguishing pathology from democratic contention via weighting." },
    { id: 15, title: "Global Infrastructure", content: "Distributed nodes in neutral jurisdictions (Switzerland, Iceland)." },
    { id: 16, title: "DOJ Download Pipeline", content: "Ingestion of Epstein corpus via headless browser scraping (Phase 3)." },
    { id: 17, title: "System Architecture (MCP)", content: "Memory Server, Eco Engine, Substrate Router, OSINT Network." },
    { id: 18, title: "Section 18: Civilizational Gap", content: "Detecting the 'infection' (structural conditions) that precedes the 'fever' (fascism)." },
    { id: 19, title: "Case Study: Palestine", content: "Worked example of loyalty-neutrality and high-rigor source assessment." },
  ];

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">CIS PRD v0.3</h2>
            <p className="text-sm text-[#888]">Autonomous, loyalty-neutral, self-defending diagnostic instrument.</p>
          </div>
          <div className="px-4 py-1 bg-[#00ff00]/10 border border-[#00ff00]/30 rounded-full">
            <span className="text-[10px] font-bold text-[#00ff00] uppercase tracking-widest">Status: Reconciled v0.3</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sections.map((section) => (
            <div key={section.id} className="p-6 bg-[#050505] border border-[#1a1a1a] rounded-xl hover:border-[#333] transition-all group">
              <div className="flex items-center gap-4 mb-3">
                <span className="text-xs font-mono text-[#444] group-hover:text-[#00ff00] transition-all">
                  SEC_{section.id.toString().padStart(2, '0')}
                </span>
                <h3 className="text-sm font-bold text-white">{section.title}</h3>
              </div>
              <p className="text-xs text-[#666] leading-relaxed">{section.content}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#00ff00]/5 border border-[#00ff00]/20 rounded-xl p-8">
        <div className="flex items-center gap-4 mb-4">
          <CheckCircle2 className="w-6 h-6 text-[#00ff00]" />
          <h3 className="text-lg font-bold text-white">v0.3 Reconciliation Complete</h3>
        </div>
        <p className="text-sm text-[#888] leading-relaxed mb-6">
          The application and documentation are now fully reconciled with the v0.3 draft. The diagnostic engine uses the weighted binary count methodology, and the civilizational gap (Section 18) has been theoretically integrated.
        </p>
        <div className="flex items-center gap-4">
          <button className="px-4 py-2 bg-[#00ff00] text-black text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#00cc00] transition-all">
            PRD v0.3 Active
          </button>
          <button className="px-4 py-2 bg-[#111] border border-[#222] text-[#888] text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#1a1a1a] transition-all">
            Review Case Study: Palestine
          </button>
        </div>
      </section>
    </div>
  );
};

const CorroborationTab = ({ items }: { items: CorroborationItem[] }) => {
  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Three-Source Corroboration Tracker</h2>
            <p className="text-sm text-[#888]">Findings must be confirmed by three independent substrates before escalation.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[10px] text-[#666] uppercase tracking-widest">Confirmed Findings</p>
              <p className="text-2xl font-black text-[#00ff00]">
                {items.filter(i => i.status === 'confirmed').length}
              </p>
            </div>
            <div className="w-px h-10 bg-[#333]" />
            <div className="text-right">
              <p className="text-[10px] text-[#666] uppercase tracking-widest">Pending Verification</p>
              <p className="text-2xl font-black text-orange-500">
                {items.filter(i => i.status === 'pending').length}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {items.map((item) => (
            <div key={item.id} className="bg-[#050505] border border-[#1a1a1a] rounded-xl p-6 hover:border-[#333] transition-all">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center border",
                    item.status === 'confirmed' ? "bg-[#00ff00]/10 border-[#00ff00] text-[#00ff00]" : "bg-orange-500/10 border-orange-500 text-orange-500"
                  )}>
                    {item.status === 'confirmed' ? <CheckCircle2 className="w-5 h-5" /> : <RefreshCw className="w-5 h-5 animate-spin" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{item.finding}</h4>
                    <p className="text-[10px] text-[#666] uppercase tracking-widest mt-1">Confidence: {item.confidence}%</p>
                  </div>
                </div>
                <span className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                  item.status === 'confirmed' ? "bg-[#00ff00] text-black" : "bg-orange-500 text-black"
                )}>
                  {item.status}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {item.sources.map((source, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-[#0f0f0f] border border-[#1a1a1a] rounded-lg">
                    <div className="flex items-center gap-3">
                      <Database className="w-3 h-3 text-[#444]" />
                      <span className="text-xs text-[#aaa]">{source.name}</span>
                    </div>
                    {source.verified ? (
                      <CheckCircle2 className="w-3 h-3 text-[#00ff00]" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border border-[#444]" />
                    )}
                  </div>
                ))}
                {item.sources.length < 3 && (
                  <div className="flex items-center justify-center p-3 bg-[#0f0f0f] border border-dashed border-[#333] rounded-lg">
                    <span className="text-[10px] text-[#444] uppercase font-bold tracking-widest">Awaiting 3rd Source</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <h3 className="text-lg font-bold text-white mb-6">Disinformation Risk Flags</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 bg-red-500/5 border border-red-500/20 rounded-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h4 className="text-sm font-bold text-red-500 uppercase tracking-widest">High Risk: Narrative Echo</h4>
            </div>
            <p className="text-xs text-[#888] leading-relaxed">
              Identified 14 independent accounts broadcasting identical phrasing within a 120-second window. High probability of coordinated inauthentic behavior.
            </p>
          </div>
          <div className="p-6 bg-orange-500/5 border border-orange-500/20 rounded-xl">
            <div className="flex items-center gap-3 mb-4">
              <Info className="w-5 h-5 text-orange-500" />
              <h4 className="text-sm font-bold text-orange-500 uppercase tracking-widest">Medium Risk: Source Drift</h4>
            </div>
            <p className="text-xs text-[#888] leading-relaxed">
              Substrate "X" reporting data that contradicts historical baselines by &gt;40%. Verifying substrate integrity.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

const VDemMonitorTab = () => {
  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">V-Dem Democratic Drift Monitor</h2>
            <p className="text-sm text-[#888]">Real-time monitoring of democratic indicators against historical baselines.</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-bold text-red-500 uppercase tracking-widest">Global Drift Alert</span>
          </div>
        </div>

        <div className="h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={VDEM_HISTORY}>
              <defs>
                <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00ff00" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#00ff00" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
              <XAxis 
                dataKey="year" 
                stroke="#444" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
              />
              <YAxis 
                stroke="#444" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false} 
                domain={[0.5, 1]}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', fontSize: '12px' }}
                itemStyle={{ color: '#00ff00' }}
              />
              <Line 
                type="monotone" 
                dataKey="baseline" 
                stroke="#444" 
                strokeDasharray="5 5" 
                dot={false} 
              />
              <Area 
                type="monotone" 
                dataKey="score" 
                stroke="#00ff00" 
                fillOpacity={1} 
                fill="url(#colorScore)" 
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-8">
          {[
            { label: 'Freedom of Expression', value: '-12%', trend: 'down' },
            { label: 'Judicial Independence', value: '-8%', trend: 'down' },
            { label: 'Electoral Integrity', value: '+2%', trend: 'up' },
            { label: 'Civil Society Space', value: '-24%', trend: 'down' },
          ].map((stat, i) => (
            <div key={i} className="p-4 bg-[#050505] border border-[#1a1a1a] rounded-lg">
              <p className="text-[10px] text-[#666] uppercase tracking-widest mb-1">{stat.label}</p>
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-white">{stat.value}</span>
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  stat.trend === 'up' ? "bg-[#00ff00]" : "bg-red-500"
                )} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
          <h3 className="text-lg font-bold text-white mb-6">Jurisdiction Watchlist</h3>
          <div className="space-y-4">
            {[
              { name: 'Jurisdiction Alpha', drift: 'High', score: 0.42, status: 'Red' },
              { name: 'Jurisdiction Beta', drift: 'Medium', score: 0.58, status: 'Orange' },
              { name: 'Jurisdiction Gamma', drift: 'Low', score: 0.72, status: 'Yellow' },
              { name: 'Jurisdiction Delta', drift: 'Stable', score: 0.85, status: 'Green' },
            ].map((j, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-[#050505] border border-[#1a1a1a] rounded-lg">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    j.status === 'Red' ? "bg-red-500" : j.status === 'Orange' ? "bg-orange-500" : j.status === 'Yellow' ? "bg-yellow-500" : "bg-[#00ff00]"
                  )} />
                  <span className="text-sm font-bold text-white">{j.name}</span>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-[9px] text-[#555] uppercase">V-Dem Score</p>
                    <p className="text-xs font-mono text-[#aaa]">{j.score}</p>
                  </div>
                  <span className="text-[10px] font-mono text-[#444] uppercase">{j.drift}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-[#0f0f0f] border border-[#222] rounded-xl p-8">
          <h3 className="text-lg font-bold text-white mb-6">Automatic Threshold Recalculation</h3>
          <div className="p-6 bg-[#050505] border border-[#1a1a1a] rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#888]">Last Recalculation</span>
              <span className="text-xs font-mono text-[#aaa]">2026-03-27 13:36:44</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#888]">Indicator Drift Weight</span>
              <span className="text-xs font-mono text-[#aaa]">1.5x (Aggressive)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#888]">Historical Baseline Window</span>
              <span className="text-xs font-mono text-[#aaa]">10 Years</span>
            </div>
            <div className="pt-4 border-t border-[#1a1a1a]">
              <button className="w-full py-2 bg-[#111] border border-[#222] text-[#00ff00] text-[10px] font-bold uppercase tracking-widest rounded hover:bg-[#1a1a1a] transition-all flex items-center justify-center gap-2">
                <RefreshCw className="w-3 h-3" />
                Force Recalculation
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('eco');
  const [servers, setServers] = useState<ServerStatus[]>(INITIAL_SERVERS);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [corpusItems, setCorpusItems] = useState<CorpusItem[]>(MOCK_CORPUS);
  const [findings, setFindings] = useState<CorroborationItem[]>(MOCK_CORROBORATION);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Real-time Sync
  useEffect(() => {
    if (!isAuthReady || !user) {
      setCorpusItems(MOCK_CORPUS);
      setFindings(MOCK_CORROBORATION);
      return;
    }

    const corpusUnsubscribe = onSnapshot(collection(db, 'corpus'), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorpusItem));
      if (items.length > 0) setCorpusItems(items);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'corpus'));

    const findingsUnsubscribe = onSnapshot(collection(db, 'findings'), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        finding: doc.data().description,
        sources: doc.data().sources,
        status: doc.data().status,
        confidence: doc.data().confidence
      } as CorroborationItem));
      if (items.length > 0) setFindings(items);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'findings'));

    return () => {
      corpusUnsubscribe();
      findingsUnsubscribe();
    };
  }, [isAuthReady, user]);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/cancelled-popup-request') {
        // Ignore this error as it's just a duplicate request being cancelled
        console.log("Login request cancelled (duplicate).");
      } else if (error.code === 'auth/popup-blocked') {
        setLoginError("Login popup was blocked by your browser. Please allow popups for this site.");
      } else if (error.code === 'auth/popup-closed-by-user') {
        // User closed the popup, no need to show a big error
        console.log("Login popup closed by user.");
      } else {
        console.error("Login failed:", error);
        setLoginError(error.message || "Login failed. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // Simulate server load changes
  useEffect(() => {
    const interval = setInterval(() => {
      setServers(prev => prev.map(s => ({
        ...s,
        load: Math.min(100, Math.max(0, s.load + (Math.random() * 10 - 5)))
      })));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#050505] text-[#ccc] flex font-sans selection:bg-[#00ff00] selection:text-black">
        <Sidebar servers={servers} activeTab={activeTab} setActiveTab={setActiveTab} />
        
        <main className="flex-1 overflow-y-auto p-12">
          <header className="mb-12 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-[10px] text-[#666] uppercase tracking-widest font-bold mb-2">
                <Terminal className="w-3 h-3" />
                <span>System Status: Operational</span>
                <span className="mx-2">•</span>
                <span>Uptime: 142h 12m</span>
              </div>
              <h1 className="text-4xl font-black text-white tracking-tighter uppercase">
                {activeTab === 'eco' && "Eco Clustering Engine"}
                {activeTab === 'corpus' && "Knowledge Corpus"}
                {activeTab === 'prd' && "CIS PRD v0.3"}
                {activeTab === 'deterrence' && "Deterrence Simulator"}
                {activeTab === 'osint' && "OSINT Network"}
                {activeTab === 'router' && "Substrate Routing Layer"}
                {activeTab === 'corroboration' && "Corroboration Tracker"}
                {activeTab === 'vdem' && "V-Dem Monitor"}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <button className="p-2 rounded-lg bg-[#111] border border-[#222] text-[#888] hover:text-white transition-all">
                <Search className="w-5 h-5" />
              </button>
              
              {user ? (
                <button 
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[#111] border border-[#222] text-[#888] hover:text-white hover:border-red-500/50 transition-all rounded-lg"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Logout</span>
                </button>
              ) : (
                <div className="relative">
                  <button 
                    onClick={handleLogin}
                    disabled={isLoggingIn}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 transition-all rounded-lg border",
                      isLoggingIn 
                        ? "bg-[#111] border-[#222] text-[#444] cursor-not-allowed" 
                        : "bg-[#00ff00]/10 border-[#00ff00]/30 text-[#00ff00] hover:bg-[#00ff00]/20"
                    )}
                  >
                    {isLoggingIn ? <RefreshCw className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      {isLoggingIn ? "Logging in..." : "Login"}
                    </span>
                  </button>
                  {loginError && (
                    <div className="absolute top-full right-0 mt-2 w-64 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-500 z-50 animate-in fade-in slide-in-from-top-1">
                      {loginError}
                      <button 
                        onClick={() => setLoginError(null)}
                        className="absolute top-1 right-1 p-1 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="w-px h-8 bg-[#222]" />
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs font-bold text-white">{user?.displayName || "Guest Investigator"}</p>
                  <p className="text-[10px] text-[#666]">{user ? "Lead Investigator" : "Unauthenticated"}</p>
                </div>
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="User" className="w-10 h-10 rounded-full border border-[#222]" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center">
                    <UserIcon className="w-5 h-5 text-[#333]" />
                  </div>
                )}
              </div>
            </div>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'eco' && <EcoClusteringTab />}
              {activeTab === 'corpus' && <CorpusTab items={corpusItems} />}
              {activeTab === 'prd' && <PrdTab />}
              {activeTab === 'deterrence' && <DeterrenceTab />}
              {activeTab === 'osint' && <OsintNetworkTab />}
              {activeTab === 'router' && <SubstrateRouterTab />}
              {activeTab === 'corroboration' && <CorroborationTab items={findings} />}
              {activeTab === 'vdem' && <VDemMonitorTab />}
            </motion.div>
          </AnimatePresence>

          <footer className="mt-24 pt-12 border-t border-[#222] flex items-center justify-between text-[10px] text-[#444] uppercase tracking-widest font-bold">
            <div className="flex items-center gap-8">
              <span>© 2026 CIS Mission Control</span>
              <span>Security Protocol: AES-256-GCM</span>
              <span>Jurisdiction: Global / Decentralized</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="#" className="hover:text-[#00ff00] transition-all flex items-center gap-1">
                <Info className="w-3 h-3" />
                Documentation
              </a>
              <a href="#" className="hover:text-[#00ff00] transition-all flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                Source Code
              </a>
            </div>
          </footer>
        </main>
      </div>
    </ErrorBoundary>
  );
}
