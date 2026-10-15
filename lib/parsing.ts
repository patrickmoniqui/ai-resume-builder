import { escapeRegex, type Resume, type Keyword } from "./model";
export const dateRange =
  /(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+)?(?:19|20)\d{2}\s*[-–—]\s*(?:Present|Current|Now|(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+)?(?:19|20)\d{2})/i;
function parseRoles(lines: string[]): Resume["roles"] {
  const roles: Resume["roles"] = [];
  let current: Resume["roles"][number] | undefined;
  let markedBullet = false;
  let company = "",
    companyStart = 0;
  // A company heading with no roles under it is kept as an empty entry.
  const keepEmptyCompany = () => {
    if (company && roles.length === companyStart)
      roles.push({ company, title: "", dates: "", bullets: [] });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      dates = line.match(dateRange)?.[0] || "";
    const companyMarker = line.match(
      /^(?:Company|Employer|Entreprise|Employeur)\s*:\s*(.+)$/i,
    );
    const teamMarker = line.match(
      /^(?:Team|Équipe|Equipe|Department|Département|Departement|Service)\s*:\s*(.*)$/i,
    );
    if (company && /^(?:Roles|Rôles)$/i.test(line)) {
      current = undefined;
      markedBullet = false;
      continue;
    }
    // Team lines (from older exports) are skipped: teams are not supported.
    if (companyMarker || teamMarker) {
      if (companyMarker) {
        keepEmptyCompany();
        company = companyMarker[1].trim();
        companyStart = roles.length;
      }
      current = undefined;
      markedBullet = false;
      continue;
    }
    const roleMarker = /^(?:Role|Rôle)\s*:\s*/i.test(line);
    const heading = line
      .replace(/^(?:Role|Rôle)\s*:\s*/i, "")
      .replace(dateRange, "")
      .replace(/\s+/g, " ")
      .trim();
    const parts = heading
      .split(/\s*[·|]\s*|\s+at\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
    const explicit = /^[•▪●-]\s/.test(line);
    const isHeading =
      !explicit &&
      parts.length >= 2 &&
      heading.length < 200 &&
      !/[.!?]$/.test(heading);
    const nextDate =
      !explicit &&
      lines[i + 1]?.match(dateRange) &&
      !/[.!?]$/.test(line) &&
      line.length < 120;
    const contextualHeading =
      !!company &&
      !explicit &&
      (!current ||
        (!!dates &&
          !!heading &&
          heading.length < 200 &&
          !/[.!?]$/.test(heading)));
    if (roleMarker || isHeading || nextDate || contextualHeading) {
      current = {
        title: parts[0]?.trim() || "",
        company:
          company ||
          parts.slice(1).join(" · ").trim() ||
          (!dates && nextDate
            ? lines[i + 1]
                .replace(dateRange, "")
                .replace(/^[\s·|–—-]+|[\s·|–—-]+$/g, "")
                .trim()
            : ""),
        dates: dates || lines[i + 1]?.match(dateRange)?.[0] || "",
        bullets: [],
      };
      roles.push(current);
      markedBullet = false;
      if (!dates && nextDate) i++;
      continue;
    }
    if (!current) {
      current = {
        title: "Imported experience",
        company,
        dates: "",
        bullets: [],
      };
      roles.push(current);
    }
    if (explicit) {
      current.bullets.push(line.replace(/^[•▪●-]\s*/, ""));
      markedBullet = true;
    } else if (markedBullet && current.bullets.length) {
      current.bullets[current.bullets.length - 1] += " " + line;
    } else current.bullets.push(line);
  }
  keepEmptyCompany();
  return roles;
}
function parseEducation(lines: string[]): Resume["edu"] {
  if (!lines.length) return [];
  return lines.map((line) => {
    const dates = line.match(dateRange)?.[0] || "";
    const parts = line
      .replace(dateRange, "")
      .trim()
      .split(/\s*[·|]\s*/)
      .filter(Boolean);
    return {
      degree: parts[0] || "",
      school: parts.slice(1).join(" · "),
      dates,
    };
  });
}
export function parseResume(text: string): Resume {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !/^\d+\s*\/\s*\d+$/.test(s));
  if (!lines.length)
    throw new Error(
      "No readable text found. Use a text-based PDF or a Word document.",
    );
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[:：]$/, "")
      .replace(/\s+/g, " ")
      .trim();
  const headingGroups: Record<string, string[]> = {
    summary: [
      "summary",
      "profile",
      "professional summary",
      "about",
      "profil",
      "profil professionnel",
      "resume professionnel",
      "sommaire",
      "objectif",
      "objectifs",
      "a propos",
    ],
    experience: [
      "experience",
      "experiences",
      "work experience",
      "professional experience",
      "employment",
      "employment history",
      "work history",
      "experience professionnelle",
      "experiences professionnelles",
      "parcours professionnel",
    ],
    skills: [
      "skills",
      "technical skills",
      "core competencies",
      "competences",
      "competences techniques",
      "competences cles",
      "expertise",
      "technologies",
    ],
    education: [
      "education",
      "formation",
      "formations",
      "formation academique",
      "etudes",
      "scolarite",
      "education et formation",
    ],
    extra: [
      "certifications",
      "certificates",
      "licenses",
      "projects",
      "personal projects",
      "selected projects",
      "languages",
      "interests",
      "awards",
      "honors",
      "publications",
      "volunteering",
      "volunteer experience",
      "references",
      "projets",
      "projets personnels",
      "projets realises",
      "langues",
      "langues parlees",
      "interets",
      "centres d'interet",
      "benevolat",
      "prix et distinctions",
      "realisations",
      "activites",
      "autres experiences",
    ],
  };
  const kind = (line: string) =>
    Object.entries(headingGroups).find(([, names]) =>
      names.includes(normalize(line)),
    )?.[0];
  const sections: { kind: string; title: string; lines: string[] }[] = [];
  const intro: string[] = [];
  let current: (typeof sections)[number] | undefined;
  for (const line of lines.slice(1)) {
    const group = kind(line);
    if (group) {
      current = { kind: group, title: line.replace(/[:：]$/, ""), lines: [] };
      sections.push(current);
    } else if (current) current.lines.push(line);
    else intro.push(line);
  }
  const content = (group: string) =>
    sections.filter((s) => s.kind === group).flatMap((s) => s.lines);
  const contact = intro.filter((s) =>
    /@|linkedin|\+?\d[\d\s().-]{6,}|https?:/i.test(s),
  );
  const headline = intro[0] && !contact.includes(intro[0]) ? intro[0] : "";
  const remainingIntro = intro.filter(
    (s, i) => !(i === 0 && headline) && !contact.includes(s),
  );
  const extras = sections
    .filter((s) => s.kind === "extra")
    .map((s) => ({ title: s.title, text: s.lines.join("\n") }));
  let extraIndex = 0;
  const sectionOrder = [
    ...new Set([
      ...(remainingIntro.length && !sections.some((s) => s.kind === "summary")
        ? ["summary"]
        : []),
      ...sections.map((s) =>
        s.kind === "extra" ? `extra-${extraIndex++}` : s.kind,
      ),
    ]),
  ];
  return {
    sectionOrder,
    name: lines[0],
    headline,
    contact: contact.join(" · "),
    summary: [...remainingIntro, ...content("summary")].join("\n"),
    skills: content("skills").join("\n"),
    roles: parseRoles(content("experience")),
    edu: parseEducation(content("education")),
    ...(extras.length ? { extraSections: extras } : {}),
  };
}

const vocabulary: Record<Keyword["category"], string[]> = {
  "Hard skills": [
    "Product strategy",
    "Roadmap",
    "A/B testing",
    "Experimentation",
    "Customer research",
    "Agile",
    "Data analysis",
    "Machine learning",
    "Evaluation",
    "Prompt",
    "Hiring",
    "Mentoring",
    "Onboarding",
    "Retention",
    "Conversion",
    "Accessibility",
    "Project management",
    "Communication",
    "Analytics",
    "Leadership",
    "UX",
    "SEO",
    "Testing",
    "CI/CD",
    "Data visualization",
    "System design",
  ],
  Tools: [
    "SQL",
    "API",
    "Python",
    "JavaScript",
    "TypeScript",
    "React",
    "Node.js",
    "Next.js",
    "Java",
    "Go",
    "Rust",
    "C++",
    "AWS",
    "Azure",
    "GCP",
    "Docker",
    "Kubernetes",
    "PostgreSQL",
    "MongoDB",
    "Git",
    "Figma",
    "Jira",
    "Looker",
    "Amplitude",
    "Excel",
    "Tableau",
    "TensorFlow",
    "PyTorch",
  ],
  Domain: [
    "Payments",
    "Fintech",
    "Pricing",
    "Subscriptions",
    "Compliance",
    "Fraud",
    "Healthcare",
    "HIPAA",
    "Mobile",
    "Platform",
    "Developer experience",
    "Robotics",
    "Growth",
    "E-commerce",
    "LLM",
    "Responsible AI",
    "Agents",
    "SaaS",
    "Security",
  ],
  "Soft skills": [
    "Cross-functional",
    "Stakeholder management",
    "Data-driven",
    "Collaboration",
    "Problem solving",
    "Technical writing",
    "Time management",
    "Teamwork",
  ],
};
export function extractKeywords(text: string): Keyword[] {
  const sentences = text.split(/\n|[.!;](?:\s|$)/);
  return Object.entries(vocabulary).flatMap(([category, terms]) =>
    terms
      .filter((term) => new RegExp("\\b" + escapeRegex(term), "i").test(text))
      .map((term) => ({
        term,
        category: category as Keyword["category"],
        required: sentences.some(
          (line) =>
            line.toLowerCase().includes(term.toLowerCase()) &&
            /required|must|essential|minimum|need|proficien|experience with/i.test(
              line,
            ),
        ),
      })),
  );
}
