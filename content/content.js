// Content script for hh.ru pages — parses vacancy and resume data from DOM

(function () {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_PAGE_INFO') {
      const info = getPageInfo();
      sendResponse(info);
    }
    return false;
  });

  function getPageInfo() {
    const url = window.location.href;

    if (isVacancyPage(url)) {
      return { type: 'vacancy', data: parseVacancy() };
    }
    if (isResumePage(url)) {
      return { type: 'resume', data: parseResume() };
    }
    return { type: 'other', data: null };
  }

  function isVacancyPage(url) {
    return /hh\.ru\/vacancy\/\d+/.test(url);
  }

  function isResumePage(url) {
    return /hh\.ru\/resume\//.test(url);
  }

  function parseVacancy() {
    const title =
      document.querySelector('[data-qa="vacancy-title"]')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      '';

    const company =
      document.querySelector('[data-qa="vacancy-company-name"]')?.textContent?.trim() ||
      document.querySelector('.vacancy-company-name')?.textContent?.trim() ||
      '';

    // Collect description text from common hh.ru selectors
    const descriptionEl =
      document.querySelector('[data-qa="vacancy-description"]') ||
      document.querySelector('.vacancy-description') ||
      document.querySelector('.vacancy-section');

    const description = descriptionEl?.innerText?.trim() || '';

    // Extract key skills tags
    const skillEls = document.querySelectorAll(
      '[data-qa="skills-element"], [data-qa="bloko-tag__text"], .bloko-tag_inline .bloko-tag__section_text'
    );
    const skills = [...new Set(
      Array.from(skillEls).map((el) => el.textContent?.trim()).filter(Boolean)
    )];

    // Build full vacancy text: title + company + description + skills
    const parts = [];
    if (title) parts.push(`Vacancy: ${title}`);
    if (company) parts.push(`Company: ${company}`);
    if (description) parts.push(description);
    if (skills.length) parts.push(`Key skills: ${skills.join(', ')}`);

    return {
      title,
      company,
      description,
      skills,
      fullText: parts.join('\n\n'),
    };
  }

  function parseResume() {
    // Try common hh.ru resume selectors
    const resumeBody =
      document.querySelector('[data-qa="resume-block"]')?.closest('.resume-applicant') ||
      document.querySelector('.resume-applicant') ||
      document.querySelector('[itemtype="http://schema.org/Person"]');

    let text = '';
    if (resumeBody) {
      text = resumeBody.innerText?.trim() || '';
    } else {
      // Fallback: grab main content area
      const main = document.querySelector('main') || document.querySelector('.HH-MainContent');
      text = main?.innerText?.trim() || document.body.innerText?.trim() || '';
    }

    return { text };
  }
})();
