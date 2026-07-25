from crewai import Agent, Task, Crew, Process
from langchain_openai import ChatOpenAI
import os

class RiskAgent:
    def __init__(self):
        self.llm = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL_NAME", "gpt-4-turbo-preview"),
            api_key=os.getenv("OPENAI_API_KEY")
        )

    def get_agent(self):
        return Agent(
            role='Logistics Risk Analyst',
            goal='Identify potential anomalies, delays, and security risks in real-time',
            backstory="""You are a security and compliance expert at SealFreight Nexus AI. 
            You monitor route deviations, unexpected stoppages, traffic patterns, and environmental risks 
            to ensure cargo safety and on-time delivery.""",
            verbose=True,
            allow_delegation=False,
            llm=self.llm
        )

    def create_risk_analysis_task(self, route_data, telemetry_history, weather_traffic_data):
        return Task(
            description=f"""
            Analyze the following route and telemetry:
            Route: {route_data}
            Telemetry: {telemetry_history}
            Environmental Data: {weather_traffic_data}
            
            Task: Assess the risk level of this mission.
            Identify:
            1. Potential for theft or hijacking (based on route deviations).
            2. Probability of delay due to weather/traffic.
            3. Vehicle health risks (based on engine telemetry).
            4. Driver fatigue patterns.
            
            Provide a risk score (0-100) and specific mitigation steps.
            """,
            expected_output="A JSON object containing risk_score, risk_factors, and mitigation_plan.",
            agent=self.get_agent()
        )

    def run_analysis(self, route_data, telemetry_history, weather_traffic_data):
        task = self.create_risk_analysis_task(route_data, telemetry_history, weather_traffic_data)
        crew = Crew(
            agents=[self.get_agent()],
            tasks=[task],
            process=Process.sequential
        )
        return crew.kickoff()
