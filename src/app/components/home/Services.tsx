"use client";
import { useState, type MouseEvent } from "react";
import Section from "../PageSection";
import styled from "styled-components";
import {
  SectionHeaderWrapper,
  SectionHeader,
  SectionBody,
  SectionSubHeader,
  SectionContent,
} from "./ServiceStyles";
import ServiceCard from "./ServiceCard";

const CardContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 16px;

  @media (min-width: 1024px) {
    flex-direction: row;
    align-items: stretch;
    gap: 24px;
  }
`;

const Services = () => {
  const [activeCard, setActiveCard] = useState("Painting");

  function handleCardClick(e: MouseEvent<HTMLDivElement>) {
    const card = e.currentTarget;
    const title = card.querySelector("h2")?.textContent || "";

    setActiveCard(title);
  }



  return (
    <Section bgcolor="#E8F2EC">
      <SectionHeaderWrapper>
        <SectionHeader>
          <span className="sectionNumber">03/ </span>Our Services
        </SectionHeader>
        <hr />
      </SectionHeaderWrapper>
      <SectionBody>
        <SectionSubHeader>
          Our various services are provided for you
        </SectionSubHeader>
        <SectionContent>
          <CardContainer>
            <ServiceCard
              isactive={activeCard === "Painting"}
              title="Painting"
              description="From newer homes to Portland’s historic neighborhoods, PPR provides interior and exterior painting with careful attention to preparation, repairs, and finishing. We tailor our approach to the age, condition, and character of each property."
              image="/images/interior/home/interior-home.jpg"
              secondImage='/images/exterior/home/exterior-home.jpeg'
              handleCardClick={handleCardClick}
            />
            <ServiceCard
              isactive={activeCard === "Carpentry"}
              title="Carpentry"
              description="Whether your property needs a few repairs before painting, a new deck, or more extensive carpentry work, PPR has the experience to bring it all together. We offer repairs, modifications, and rebuilds with an emphasis on quality workmanship and long-term performance."
              image="/gallery/carpentry1.jpg"
              handleCardClick={handleCardClick}
            />
            <ServiceCard
              isactive={activeCard === "Restoration"}
              title="Restoration"
              description="PPR provides thoughtful restoration solutions that preserve the character of your property. We focus on addressing underlying damage, retaining original features whenever practical, and extending the life of existing structures."
              image="/gallery/restoration1.jpg"
              handleCardClick={handleCardClick}
            />
          </CardContainer>
        </SectionContent>
      </SectionBody>
    </Section>
  );
};

export default Services;
