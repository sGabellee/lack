// ====== LACK TEMPLATES MODULE ======
// Overleaf-style professional LaTeX templates and user custom template manager

(function () {
const DEFAULT_CATEGORIES = [
  { id: 'academic', label: 'Academic & Papers' },
  { id: 'reports', label: 'University & Lab Reports' },
  { id: 'thesis', label: 'Theses & Books' },
  { id: 'beamer', label: 'Presentations (Beamer)' },
  { id: 'cv', label: 'Curriculum Vitae & Resumes' },
  { id: 'assignments', label: 'Assignments & Math' },
  { id: 'other', label: 'Other' }
];

const DEFAULT_TEMPLATES = [
  {
    id: 'ieee-conference',
    title: 'IEEE Conference Paper',
    category: 'academic',
    categoryLabel: 'Academic & Papers',
    description: 'Standard IEEE two-column conference paper template with title, authors, affiliations, abstract, IEEEkeywords, equations, figures, and IEEEtran bibliography.',
    suggestedFilename: 'ieee_paper.tex',
    content: `\\documentclass[conference]{IEEEtran}
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{algorithmic}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}

\\begin{document}

\\title{Conference Paper Title*\\\\
{\\footnotesize \\textsuperscript{*}Note: Sub-titles are not recommended for IEEE titles.}}

\\author{\\IEEEauthorblockN{1\\textsuperscript{st} Given Name Surname}
\\IEEEauthorblockA{\\textit{dept. name of organization} \\\\
\\textit{name of organization}\\\\
City, Country \\\\
email@example.com}
\\and
\\IEEEauthorblockN{2\\textsuperscript{nd} Given Name Surname}
\\IEEEauthorblockA{\\textit{dept. name of organization} \\\\
\\textit{name of organization}\\\\
City, Country \\\\
email@example.com}
}

\\maketitle

\\begin{abstract}
This electronic document is a live template. The abstract should briefly summarize the research problem, methodology, key findings, and contributions. It should be concise and not exceed 200 words.
\\end{abstract}

\\begin{IEEEkeywords}
machine learning, embedded systems, performance evaluation, latex
\\end{IEEEkeywords}

\\section{Introduction}
This document is a template for \\LaTeXe. Most conferences require IEEE formatting for camera-ready submissions. When you submit your final version, after your paper has been accepted, prepare it in two-column format.

\\section{Related Work}
Discuss pertinent literature and prior state-of-the-art developments here. Use standard citations such as \\cite{ref1}.

\\section{System Architecture}
The system architecture encompasses several interdependent modules. Fig. \\ref{fig:arch} demonstrates the high-level workflow.

\\begin{figure}[htbp]
\\centering
% Replace with your figure file:
% \\includegraphics[width=0.85\\linewidth]{architecture.png}
\\framebox[0.85\\linewidth]{\\rule{0pt}{4cm} Architecture Diagram Placeholder}
\\caption{High-level architectural pipeline.}
\\label{fig:arch}
\\end{figure}

\\section{Mathematical Formulation}
Let $\\mathcal{S}$ denote the set of states, and $\\mathcal{A}$ the set of available actions. The objective function is formulated as follows:

\\begin{equation}
J(\\theta) = \\mathbb{E}_{\\tau \\sim \\pi_\\theta} \\left[ \\sum_{t=0}^{T} \\gamma^t r(s_t, a_t) \\right]
\\label{eq:objective}
\\end{equation}

where $\\gamma \\in [0, 1)$ represents the discount factor, and $r(s_t, a_t)$ denotes the immediate reward.

\\section{Experimental Results}
Table \\ref{tab:results} summarizes the benchmark evaluations across three workload profiles.

\\begin{table}[htbp]
\\caption{Comparative Performance Metrics}
\\begin{center}
\\begin{tabular}{|c|c|c|c|}
\\hline
\\textbf{Workload}&\\textbf{Latency (ms)}&\\textbf{Throughput (ops/s)}&\\textbf{Accuracy (\\%)} \\\\
\\hline
Light & 4.2 & 12,450 & 98.4 \\\\
Medium & 8.9 & 8,120 & 97.9 \\\\
Heavy & 17.5 & 3,940 & 96.8 \\\\
\\hline
\\end{tabular}
\\label{tab:results}
\\end{center}
\\end{table}

\\section{Conclusion}
We presented the complete design and empirical validation of the proposed platform. Future work will focus on distributed deployment and latency minimization.

\\begin{thebibliography}{00}
\\bibitem{ref1} G. Carbone and A. Rossi, \`\`Advanced real-time systems in modern computing,'' \\textit{IEEE Transactions on Computers}, vol. 72, no. 4, pp. 1102--1115, 2025.
\\end{thebibliography}

\\end{document}
`
  },
  {
    id: 'lab-report',
    title: 'University Lab & Technical Report',
    category: 'reports',
    categoryLabel: 'University & Lab Reports',
    description: 'Comprehensive academic laboratory and project report template with title page, abstract, table of contents, methodology, code listings, data tables, and conclusion.',
    suggestedFilename: 'lab_report.tex',
    content: `\\documentclass[12pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{hyperref}
\\usepackage{fancyhdr}
\\usepackage{listings}
\\usepackage{xcolor}

% Header and Footer configuration
\\pagestyle{fancy}
\\fancyhf{}
\\rhead{Laboratory Report}
\\lhead{Course: Advanced Embedded Systems}
\\cfoot{\\thepage}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,      
    urlcolor=cyan,
    citecolor=blue
}

\\begin{document}

\\begin{titlepage}
    \\centering
    \\vspace*{1cm}
    {\\scshape\\LARGE University of Engineering \\par}
    \\vspace{1.5cm}
    {\\scshape\\Large Laboratory Report \\#3\\par}
    \\vspace{1cm}
    {\\huge\\bfseries Real-Time Task Scheduling and Fault Tolerance Analysis\\par}
    \\vspace{2cm}
    {\\Large\\itshape Student: Gaetano Carbone\\\\ ID: 1049281\\par}
    \\vfill
    supervised by\\\\
    Prof.~A. Rossi
    \\vfill
    {\\large \\today\\par}
\\end{titlepage}

\\begin{abstract}
This laboratory activity investigated the preemptive scheduling behavior of real-time operating systems under stochastic interrupt loads. Using hardware trace capture, we measured worst-case execution time (WCET) and context switch latency. The experimental findings corroborate theoretical rate-monotonic bounds.
\\end{abstract}

\\tableofcontents
\\newpage

\\section{Introduction and Objectives}
The primary objective of this laboratory exercise is to analyze task isolation and interrupt latency in a real-time environment. 

\\subsection{Equipment and Toolchain}
The experimental testbench consists of:
\\begin{itemize}
    \\item ARM Cortex-M4 microcontroller development board.
    \\item 4-channel digital mixed-signal oscilloscope.
    \\item OpenOCD debugger and GCC ARM Embedded toolchain.
\\end{itemize}

\\section{Theoretical Background}
Rate Monotonic Scheduling assigns static priorities based on task periods $T_i$. The classic Liu and Layland utilization bound for $n$ periodic tasks is given by:

\\begin{equation}
U = \\sum_{i=1}^{n} \\frac{C_i}{T_i} \\le n \\left( 2^{1/n} - 1 \\right)
\\label{eq:liu_layland}
\\end{equation}

where $C_i$ denotes the computation time of task $\\tau_i$.

\\section{Experimental Methodology}
Tasks were configured with periodic timers and hardware GPIO toggles to enable sub-microsecond timing measurements on the logic analyzer.

\\section{Results and Discussion}
Table \\ref{tab:measurements} compares the predicted execution time against the empirically measured values across 10,000 sampling iterations.

\\begin{table}[htbp]
\\centering
\\caption{Execution Timing Analysis}
\\begin{tabular}{lcccc}
\\toprule
\\textbf{Task} & \\textbf{Period $T$ (ms)} & \\textbf{Nominal $C$ (ms)} & \\textbf{Measured WCET (ms)} & \\textbf{Jitter ($\\mu$s)} \\\\
\\midrule
Sensor Acquisition & 10.0 & 1.20 & 1.34 & 12.4 \\\\
Control Algorithm   & 25.0 & 4.50 & 4.88 & 18.2 \\\\
Telemetry Stream    & 100.0 & 12.0 & 13.1 & 45.6 \\\\
\\bottomrule
\\end{tabular}
\\label{tab:measurements}
\\end{table}

\\section{Conclusions}
The measured task response times complied strictly with all hard deadlines. Preemption jitter remained well within the design budget of $50\\,\\mu\\text{s}$.

\\end{document}
`
  },
  {
    id: 'beamer-presentation',
    title: 'Beamer Slide Presentation',
    category: 'beamer',
    categoryLabel: 'Presentations (Beamer)',
    description: 'Modern, elegant LaTeX Beamer presentation template with title slide, table of contents, column layouts, block highlights, mathematical proofs, and conclusion.',
    suggestedFilename: 'presentation.tex',
    content: `\\documentclass[10pt,aspectratio=169]{beamer}
\\usetheme{Madrid}
\\usecolortheme{default}

\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}

\\title[Modern LaTeX Engine]{High-Performance Computing and LaTeX Workflow}
\\subtitle{Design and Implementation of LACK Suite}
\\author[G. Carbone]{Gaetano Carbone}
\\institute[Uni]{Department of Computer Engineering}
\\date[2026]{\\today}

\\begin{document}

\\begin{frame}
    \\titlepage
\\end{frame}

\\begin{frame}{Outline}
    \\tableofcontents
\\end{frame}

\\section{Motivation}
\\begin{frame}{Why High-Speed LaTeX Toolchains Matter}
    \\begin{itemize}
        \\item Academic publishing demands rigorous typographic quality.
        \\item Traditional compilation pipelines suffer from slow feedback loops.
        \\item Seamless collaboration requires zero setup and instant peer synchronization.
    \\end{itemize}
    \\vspace{0.5cm}
    \\begin{block}{Core Objective}
        Combine the speed of local execution with the full collaborative power of modern web standards.
    \\end{block}
\\end{frame}

\\section{Architecture}
\\begin{frame}{System Architecture Overview}
    \\begin{columns}[c]
        \\column{0.5\\textwidth}
        \\textbf{Key Architectural Pillars:}
        \\begin{enumerate}
            \\item Local native engine orchestration (pdfLaTeX, Tectonic).
            \\item Real-time WebRTC CRDT synchronization (Yjs).
            \\item Integrated dual-mode PDF viewer with SyncTeX jump.
        \\end{enumerate}

        \\column{0.5\\textwidth}
        \\begin{exampleblock}{Efficiency Metric}
            Sub-second incremental rebuild times on standard multicore hardware.
        \\end{exampleblock}
    \\end{columns}
\\end{frame}

\\section{Mathematical Models}
\\begin{frame}{Mathematical Formulations}
    Given a matrix $A \\in \\mathbb{R}^{m \\times n}$, singular value decomposition factorizes:
    \\[
        A = U \\Sigma V^T
    \\]
    where $U$ and $V$ are orthogonal matrices and $\\Sigma$ is diagonal with singular values:
    \\[
        \\sigma_1 \\ge \\sigma_2 \\ge \\dots \\ge \\sigma_r > 0
    \\]
\\end{frame}

\\section{Conclusion}
\\begin{frame}{Summary and Roadmap}
    \\begin{alertblock}{Achievements}
        Complete desktop suite integration with unified styling and unlimited compilations.
    \\end{alertblock}
    \\vspace{0.3cm}
    \\begin{itemize}
        \\item Cross-platform installers for Ubuntu, macOS, and Windows.
        \\item In-app template gallery and multi-file project support.
    \\end{itemize}
\\end{frame}

\\end{document}
`
  },
  {
    id: 'academic-thesis',
    title: 'Master & Bachelor Thesis',
    category: 'thesis',
    categoryLabel: 'Theses & Books',
    description: 'Complete thesis project structure featuring front matter, abstract, dedication, chapter organization, mathematical appendices, and bibliography.',
    suggestedFilename: 'thesis_main.tex',
    content: `\\documentclass[12pt,a4paper,twoside,openright]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=3cm]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{hyperref}
\\usepackage{setspace}
\\onehalfspacing

\\begin{document}

\\begin{titlepage}
    \\centering
    {\\Large\\scshape University of Engineering \\par}
    \\vspace{0.5cm}
    {\\large Department of Computer Science and Engineering \\par}
    \\vspace{1.5cm}
    {\\huge\\bfseries Fault Tolerance and Real-Time Scheduling in Distributed Microkernel Architectures \\par}
    \\vspace{2cm}
    {\\Large Candidate: \\textbf{Gaetano Carbone} \\par}
    \\vspace{0.5cm}
    {\\large Matricola: 1049281 \\par}
    \\vfill
    {\\large Supervisor: \\textbf{Prof. Andrea Rossi} \\\\ Co-Supervisor: \\textbf{Dr. Elena Bianchi} \\par}
    \\vfill
    {\\large Academic Year 2025/2026 \\par}
\\end{titlepage}

\\chapter*{Abstract}
This thesis investigates resilient task isolation and deterministic communication in contemporary microkernel operating systems. Through extensive physical fault injection experiments, we demonstrate that spatial and temporal task compartmentalization limits fault propagation to under 0.05\\% of non-faulty partitions.

\\chapter*{Dedication}
\\textit{To my family, mentors, and friends who made this journey possible.}

\\tableofcontents
\\listoffigures
\\listoftables

\\chapter{Introduction}
\\section{Context and Motivation}
Modern safety-critical embedded systems increasingly integrate heterogeneous workloads upon shared multicore platforms. The preservation of hard real-time guarantees in the presence of hardware transients represents an essential challenge.

\\section{Thesis Structure}
This dissertation is organized as follows: Chapter 2 reviews the state of the art; Chapter 3 introduces the microkernel architecture; Chapter 4 presents empirical benchmark evaluations.

\\chapter{System Architecture}
\\section{Microkernel Design Principles}
Microkernels minimize the code running in privileged supervisor mode. Device drivers, file systems, and network protocols run as user-level server processes.

\\begin{equation}
\\mathcal{R}_{fail} = 1 - \\prod_{k=1}^{M} (1 - \\lambda_k \\cdot t)
\\end{equation}

\\chapter{Conclusion and Future Research}
We developed and validated a verified scheduling runtime capable of sub-microsecond context switches with proven temporal isolation.

\\begin{thebibliography}{9}
\\bibitem{klein} G. Klein et al., \`\`seL4: Formal verification of an OS kernel,'' \\textit{ACM SOSP}, 2009.
\\end{thebibliography}

\\end{document}
`
  },
  {
    id: 'modern-cv',
    title: 'Professional Curriculum Vitae',
    category: 'cv',
    categoryLabel: 'Curriculum Vitae & Resumes',
    description: 'Clean, elegant, two-column or sectioned CV template with contact info, education, skills, work experience, projects, and publications.',
    suggestedFilename: 'curriculum_vitae.tex',
    content: `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1.8cm]{geometry}
\\usepackage{hyperref}
\\usepackage{enumitem}
\\usepackage{xcolor}

\\definecolor{primary}{RGB}{30, 41, 59}
\\definecolor{accent}{RGB}{37, 99, 235}

\\pagestyle{empty}
\\setlist[itemize]{leftmargin=*,noitemsep,topsep=2pt}

\\newcommand{\\cvsection}[1]{%
  \\vspace{10pt}%
  {\\color{primary}\\large\\bfseries\\scshape #1}%
  \\vspace{2pt}%
  \\hrule height 1pt
  \\vspace{6pt}%
}

\\begin{document}

\\begin{center}
    {\\huge\\bfseries\\color{primary} Gaetano Carbone} \\\\[4pt]
    {\\color{accent} Software Engineer \\& Systems Researcher} \\\\[4pt]
    \\small 
    Email: \\href{mailto:gaetanocarbone2004@gmail.com}{gaetanocarbone2004@gmail.com} \\;$\\cdot$\\;
    Phone: +39 333 1234567 \\;$\\cdot$\\;
    GitHub: \\href{https://github.com/sGabellee}{github.com/sGabellee} \\;$\\cdot$\\;
    Rome, Italy
\\end{center}

\\cvsection{Education}
\\textbf{M.Sc. in Computer Engineering} \\hfill 2024 -- Present \\\\
\\textit{Sapienza University of Rome} \\hfill GPA: 29.5/30 \\\\
Specialization in Embedded Real-Time Systems, Microkernels, and Operating Systems.

\\vspace{4pt}
\\textbf{B.Sc. in Computer and Systems Engineering} \\hfill 2021 -- 2024 \\\\
\\textit{Sapienza University of Rome} \\hfill 110/110 con Lode

\\cvsection{Technical Skills}
\\begin{itemize}
    \\item \\textbf{Languages:} C/C++, Rust, Python, JavaScript/TypeScript, ARM Assembly, LaTeX.
    \\item \\textbf{Systems \\& Tools:} Linux, RTOS (FreeRTOS, Zephyr), Git, Docker, QEMU, GDB.
    \\item \\textbf{Technologies:} Electron, WebRTC, High-Performance Computing, Embedded Systems.
\\end{itemize}

\\cvsection{Professional Experience}
\\textbf{Lead Software Engineer} \\hfill 2024 -- Present \\\\
\\textit{Open Source Systems & Tools Development} \\hfill Remote
\\begin{itemize}
    \\item Architected and launched Mark (Markdown editor) and Lack (LaTeX editor suite).
    \\item Implemented zero-configuration peer-to-peer collaboration via Yjs and WebRTC.
    \\item Optimized build pipelines achieving sub-second LaTeX compilation on native engines.
\\end{itemize}

\\vspace{4pt}
\\textbf{Embedded Software Intern} \\hfill 2023 -- 2024 \\\\
\\textit{Electronics & IoT Research Lab} \\hfill Rome, Italy
\\begin{itemize}
    \\item Developed low-power firmware drivers for STM32 and Nordic Semiconductor SoCs.
    \\item Reduced sensor acquisition latency by 34\\% through DMA ping-pong buffers.
\\end{itemize}

\\cvsection{Selected Projects}
\\textbf{Lack -- Professional LaTeX Editor Suite} \\hfill 2026 \\\\
Cross-platform LaTeX development environment featuring compiler orchestration, live synchronization, and unlimited peer-to-peer real-time collaboration.

\\end{document}
`
  },
  {
    id: 'homework-assignment',
    title: 'Homework & Problem Set',
    category: 'assignments',
    categoryLabel: 'Assignments & Math',
    description: 'Clean problem set template with numbered problems, statement boxes, step-by-step mathematical solutions, and proofs.',
    suggestedFilename: 'problem_set.tex',
    content: `\\documentclass[12pt,a4paper]{article}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{mdframed}
\\usepackage{fancyhdr}

\\pagestyle{fancy}
\\lhead{Mathematics & Computer Science}
\\chead{Problem Set \\#2}
\\rhead{G. Carbone}

\\newcounter{problem}
\\newenvironment{problem}[1][]{%
  \\refstepcounter{problem}%
  \\begin{mdframed}[linewidth=1pt,linecolor=black!30,backgroundcolor=black!3]
  \\textbf{Problem \\theproblem.} \\textit{#1}\\par
  \\vspace{0.2cm}
}{%
  \\end{mdframed}
  \\vspace{0.4cm}
}

\\begin{document}

\\section*{Problem Set 2: Linear Algebra and Discrete Optimization}
\\textbf{Student:} Gaetano Carbone \\hfill \\textbf{Date:} \\today \\\\
\\hrule
\\vspace{0.5cm}

\\begin{problem}[Eigenvalue Spectrum and Positive Definiteness]
Let $A \\in \\mathbb{R}^{n \\times n}$ be a symmetric real matrix. Prove that $A$ is positive definite if and only if all its eigenvalues are strictly positive.
\\end{problem}

\\noindent\\textbf{Solution:} \\par
By the Spectral Theorem for real symmetric matrices, there exists an orthonormal basis of eigenvectors $v_1, \\dots, v_n$ with corresponding real eigenvalues $\\lambda_1, \\dots, \\lambda_n$ such that:
\\[
A = \\sum_{i=1}^n \\lambda_i v_i v_i^T
\\]
For any non-zero vector $x \\in \\mathbb{R}^n$, expand $x = \\sum_{i=1}^n c_i v_i$ where $c_i = v_i^T x$. Then:
\\[
x^T A x = \\left( \\sum_{i=1}^n c_i v_i^T \\right) \\left( \\sum_{j=1}^n \\lambda_j c_j v_j \\right) = \\sum_{i=1}^n \\lambda_i c_i^2
\\]
Since $x \\neq 0$, at least one $c_i \\neq 0$ so $\\sum c_i^2 > 0$. If $\\lambda_i > 0$ for all $i$, then $x^T A x > 0$, establishing that $A$ is positive definite. Conversely, choose $x = v_k$; then $v_k^T A v_k = \\lambda_k > 0$. \\qed

\\begin{problem}[Convergence of Gradient Descent]
Consider the quadratic objective $f(x) = \\frac{1}{2} x^T Q x - b^T x$ where $Q \\succ 0$ with condition number $\\kappa = \\lambda_{\\max}(Q) / \\lambda_{\\min}(Q)$. Derive the optimal step size $\\alpha^*$.
\\end{problem}

\\noindent\\textbf{Solution:} \\par
The gradient is given by $\\nabla f(x) = Qx - b$. The exact line search step yields:
\\[
\\alpha^* = \\frac{2}{\\lambda_{\\max}(Q) + \\lambda_{\\min}(Q)}
\\]
which guarantees maximum contraction rate of $\\left( \\frac{\\kappa - 1}{\\kappa + 1} \\right)$.

\\end{document}
`
  }
];

const STORAGE_KEY_TEMPLATES = 'lack_custom_templates';
const STORAGE_KEY_CATEGORIES = 'lack_custom_categories';

function getCustomCategories() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CATEGORIES);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function getAllCategories() {
  const custom = getCustomCategories();
  return [...DEFAULT_CATEGORIES, ...custom];
}

function getCustomTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TEMPLATES);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function getAllTemplates() {
  const custom = getCustomTemplates();
  return [...DEFAULT_TEMPLATES, ...custom];
}

function saveCustomTemplate({ id, title, category, description, content, suggestedFilename }) {
  const custom = getCustomTemplates();
  const templateId = id || `custom-${Date.now()}`;
  const existingIdx = custom.findIndex(t => t.id === templateId);

  const categories = getAllCategories();
  const catObj = categories.find(c => c.id === category);
  const categoryLabel = catObj ? catObj.label : 'Other';

  const templateObj = {
    id: templateId,
    title: title.trim(),
    category: category || 'other',
    categoryLabel: categoryLabel,
    description: (description || '').trim(),
    suggestedFilename: suggestedFilename || `${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.tex`,
    content: content,
    isCustom: true,
    createdAt: new Date().toISOString()
  };

  if (existingIdx !== -1) {
    custom[existingIdx] = templateObj;
  } else {
    custom.unshift(templateObj);
  }

  try {
    localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(custom));
  } catch (e) {
    console.error('Could not save custom template:', e);
  }

  return templateObj;
}

function deleteCustomTemplate(id) {
  let custom = getCustomTemplates();
  custom = custom.filter(t => t.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(custom));
  } catch (e) {}
}

const LackTemplates = {
  DEFAULT_CATEGORIES,
  DEFAULT_TEMPLATES,
  getAllCategories,
  getAllTemplates,
  getCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate
};

if (typeof module !== 'undefined') {
  module.exports = LackTemplates;
}
if (typeof window !== 'undefined') {
  window.LackTemplates = LackTemplates;
}
})();
